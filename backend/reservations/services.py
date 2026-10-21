from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Reservation, Resource

TimeWindow = tuple[int, int, bool]
DAY_MICROSECONDS = 24 * 60 * 60 * 1_000_000


def _time_value(value: time) -> int:
    return (
        ((value.hour * 60 + value.minute) * 60 + value.second) * 1_000_000
        + value.microsecond
    )


def _resource_windows_by_weekday(
    resource: Resource,
) -> dict[int, list[TimeWindow]] | None:
    constraints = list(
        resource.constraints.all().values_list(
            "day_of_week",
            "start_time",
            "end_time",
            "is_full_day",
            "is_active",
        )
    )
    if not constraints:
        start = _time_value(resource.default_start_time)
        end = _time_value(resource.default_end_time)
        full_day = start == 0 and end == _time_value(time(23, 59))
        return {
            day: [(start, DAY_MICROSECONDS if full_day else end, full_day)]
            for day in range(7)
        }

    windows_by_weekday: dict[int, list[TimeWindow]] = {}
    for weekday, start_time, end_time, is_full_day, is_active in constraints:
        if not is_active:
            continue
        start = _time_value(start_time)
        end = DAY_MICROSECONDS if is_full_day else _time_value(end_time)
        windows_by_weekday.setdefault(weekday, []).append(
            (start, end, is_full_day)
        )
    return windows_by_weekday


def get_resource_time_windows(
    resource: Resource,
    booking_date: date,
    windows_by_weekday: dict[int, list[TimeWindow]] | None = None,
) -> list[TimeWindow]:
    if windows_by_weekday is None:
        windows_by_weekday = _resource_windows_by_weekday(resource)
    if windows_by_weekday is None:
        return []
    return windows_by_weekday.get(booking_date.weekday(), [])


def _iter_booking_segments(
    reservation_date: date,
    start_time: time | None,
    end_date: date | None,
    end_time: time | None,
    is_full_day: bool = False,
):
    if end_date is None:
        end_date = reservation_date
    if end_date < reservation_date:
        raise ValueError("The reservation end date must be on or after the start date.")

    if is_full_day:
        current_date = reservation_date
        while current_date <= end_date:
            yield current_date, 0, DAY_MICROSECONDS
            current_date += timedelta(days=1)
        return

    if start_time is None or end_time is None:
        raise ValueError("Start and end times are required for a timed reservation.")

    start_datetime = datetime.combine(reservation_date, start_time)
    end_datetime = datetime.combine(end_date, end_time)
    if end_datetime <= start_datetime:
        raise ValueError("The reservation end time must be later than the start time.")

    current_date = reservation_date
    while current_date <= end_date:
        segment_start = _time_value(start_time) if current_date == reservation_date else 0
        segment_end = (
            _time_value(end_time)
            if current_date == end_date
            else DAY_MICROSECONDS
        )
        if segment_end > segment_start:
            yield current_date, segment_start, segment_end
        current_date += timedelta(days=1)


def validate_reservation_payload(
    resource: Resource,
    reservation_date: date,
    start_time: time | None,
    end_time: time | None,
    reservation_id: int | None = None,
    *,
    end_date: date | None = None,
    is_full_day: bool = False,
) -> None:
    if not resource.is_active:
        raise ValueError("This resource is not active and cannot be reserved.")

    effective_end_date = end_date or reservation_date
    segments = list(
        _iter_booking_segments(
            reservation_date,
            start_time,
            effective_end_date,
            end_time,
            is_full_day,
        )
    )
    if not segments:
        raise ValueError("The reservation end time must be later than the start time.")

    windows_by_weekday = _resource_windows_by_weekday(resource)
    for booking_date, segment_start, segment_end in segments:
        allowed_windows = get_resource_time_windows(
            resource,
            booking_date,
            windows_by_weekday,
        )
        if is_full_day:
            available = any(window_full_day for _, _, window_full_day in allowed_windows)
        else:
            available = any(
                segment_start >= allowed_start and segment_end <= allowed_end
                for allowed_start, allowed_end, _ in allowed_windows
            )
        if not available:
            raise ValueError(
                "The requested time falls outside the resource's configured availability."
            )

    conflicts = Reservation.objects.filter(
        resource=resource,
        status__in=[Reservation.STATUS_CONFIRMED, Reservation.STATUS_PENDING],
        reservation_date__lte=effective_end_date,
    ).filter(
        Q(end_date__gte=reservation_date)
        | Q(end_date__isnull=True, reservation_date__gte=reservation_date)
    )
    if reservation_id:
        conflicts = conflicts.exclude(id=reservation_id)

    for existing in conflicts.only(
        "reservation_date",
        "end_date",
        "start_time",
        "end_time",
        "is_full_day",
    ):
        existing_segments = list(
            _iter_booking_segments(
                existing.reservation_date,
                existing.start_time,
                existing.end_date,
                existing.end_time,
                existing.is_full_day,
            )
        )
        for requested_date, requested_start, requested_end in segments:
            for existing_date, existing_start, existing_end in existing_segments:
                if (
                    requested_date == existing_date
                    and requested_start < existing_end
                    and requested_end > existing_start
                ):
                    raise ValueError(
                        "This time overlaps an existing reservation for the same resource."
                    )


@transaction.atomic
def create_or_update_reservation(
    *,
    reservation=None,
    user,
    resource_id,
    reservation_date,
    start_time: time | None,
    end_time: time | None,
    notes="",
    admin_override=False,
    end_date=None,
    is_full_day=False,
):
    if reservation_date is None:
        raise ValueError("A reservation date is required.")

    today = timezone.localdate()
    if reservation_date < today:
        raise ValueError("Reservations cannot be made for past dates.")
    if reservation_date == today:
        if is_full_day:
            raise ValueError("Full-day reservations must start on a future date.")
        if start_time is None or start_time <= timezone.localtime().time():
            raise ValueError("Reservations for today must start at a future time.")

    resource = Resource.objects.select_for_update().get(id=resource_id)

    if reservation is None:
        reservation = Reservation(user=user, resource=resource)

    if not admin_override and user.role != "ADMIN" and reservation.user_id not in [None, user.id]:
        raise PermissionError("You can only modify your own reservations.")

    effective_end_date = end_date or reservation_date
    validate_reservation_payload(
        resource,
        reservation_date,
        start_time,
        end_time,
        reservation_id=getattr(reservation, "id", None),
        end_date=effective_end_date,
        is_full_day=is_full_day,
    )

    reservation.user = user
    reservation.resource = resource
    reservation.reservation_date = reservation_date
    reservation.end_date = effective_end_date
    reservation.start_time = start_time
    reservation.end_time = end_time
    reservation.is_full_day = is_full_day
    reservation.notes = notes
    if not reservation.pk and reservation.status == Reservation.STATUS_CANCELLED:
        reservation.status = Reservation.STATUS_CONFIRMED
    reservation.save()
    return reservation


@transaction.atomic
def cancel_reservation(reservation, user, admin_override=False):
    reservation = (
        Reservation.objects.select_for_update()
        .filter(pk=reservation.pk)
        .first()
    )
    if reservation is None:
        return

    if not admin_override and user.role != "ADMIN" and reservation.user_id != user.id:
        raise PermissionError("You do not have permission to cancel this reservation.")

    reservation.delete()
