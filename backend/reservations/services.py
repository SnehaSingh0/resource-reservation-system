from __future__ import annotations

from datetime import date, time

from django.db import transaction
from django.db.models import Q

from .models import Reservation, Resource, ResourceAvailabilityConstraint


def get_resource_time_windows(resource: Resource, booking_date: date) -> list[tuple[time, time]]:
    if resource.constraints.exists():
        return list(
            resource.constraints.filter(
                day_of_week=booking_date.weekday(),
                is_active=True,
            )
            .order_by("start_time")
            .values_list("start_time", "end_time")
        )
    return [(resource.default_start_time, resource.default_end_time)]


def overlaps(start_a: time, end_a: time, start_b: time, end_b: time) -> bool:
    return start_a < end_b and end_a > start_b


def validate_reservation_payload(
    resource: Resource,
    reservation_date: date,
    start_time: time,
    end_time: time,
    reservation_id: int | None = None,
) -> None:
    if start_time >= end_time:
        raise ValueError("The reservation end time must be later than the start time.")

    if not resource.is_active:
        raise ValueError("This resource is not active and cannot be reserved.")

    allowed_windows = get_resource_time_windows(resource, reservation_date)
    if not any(start_time >= allowed_start and end_time <= allowed_end for allowed_start, allowed_end in allowed_windows):
        raise ValueError(
            "The requested time falls outside the resource's configured availability."
        )

    conflicts = Reservation.objects.filter(
        resource=resource,
        reservation_date=reservation_date,
        status__in=[Reservation.STATUS_CONFIRMED, Reservation.STATUS_PENDING],
    )
    if reservation_id:
        conflicts = conflicts.exclude(id=reservation_id)

    for existing in conflicts:
        if overlaps(start_time, end_time, existing.start_time, existing.end_time):
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
    start_time,
    end_time,
    notes="",
    admin_override=False,
):
    resource = Resource.objects.select_for_update().get(id=resource_id)

    if reservation is None:
        reservation = Reservation(user=user, resource=resource)

    if not admin_override and user.role != "ADMIN" and reservation.user_id not in [None, user.id]:
        raise PermissionError("You can only modify your own reservations.")

    validate_reservation_payload(
        resource,
        reservation_date,
        start_time,
        end_time,
        reservation_id=getattr(reservation, "id", None),
    )

    reservation.user = user
    reservation.resource = resource
    reservation.reservation_date = reservation_date
    reservation.start_time = start_time
    reservation.end_time = end_time
    reservation.notes = notes
    if not reservation.pk and reservation.status == Reservation.STATUS_CANCELLED:
        reservation.status = Reservation.STATUS_CONFIRMED
    reservation.save()
    return reservation


@transaction.atomic
def cancel_reservation(reservation, user, admin_override=False):
    if not admin_override and user.role != "ADMIN" and reservation.user_id != user.id:
        raise PermissionError("You do not have permission to cancel this reservation.")

    if reservation.status == Reservation.STATUS_CANCELLED:
        return reservation

    reservation.status = Reservation.STATUS_CANCELLED
    reservation.save(update_fields=["status", "updated_at"])
    return reservation
