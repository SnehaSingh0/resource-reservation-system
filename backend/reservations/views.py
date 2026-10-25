from __future__ import annotations

import logging
import platform
import re
import secrets
import ssl
import traceback
from datetime import time, timedelta
from functools import wraps
from time import perf_counter_ns, process_time_ns

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.hashers import identify_hasher, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.debug import sensitive_variables
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Reservation, Resource, ResourceAvailabilityConstraint, User
from .permissions import IsAdminOrReadOnly, IsAdminUser, IsOwnerOrAdmin
from .serializers import (
    ReservationSerializer,
    ReservationWriteSerializer,
    AdminUpdateSerializer,
    ResourceAvailabilityConstraintSerializer,
    ResourceAvailabilityQuerySerializer,
    ResourceSerializer,
    UserSerializer,
)
from .services import cancel_reservation, create_or_update_reservation
from .throttles import LoginIPRateThrottle, LoginRateThrottle

UserModel = get_user_model()
logger = logging.getLogger(__name__)
timing_logger = logging.getLogger("reservations.request_timing")

_MISSING_TABLE = re.compile(r'relation "([^"]+)" does not exist')
_MISSING_COLUMN = re.compile(r'column "([^"]+)" does not exist')


def _timed_view_handler(route):
    def decorate(handler):
        @wraps(handler)
        def wrapped(self, request, *args, **kwargs):
            if not settings.REQUEST_TIMING_ENABLED:
                return handler(self, request, *args, **kwargs)

            started_at = perf_counter_ns()
            response = None
            try:
                response = handler(self, request, *args, **kwargs)
                return response
            finally:
                status_code = response.status_code if response is not None else "exception"
                timing_logger.info(
                    "phase=view_handler method=GET path=/%s status=%s duration_ms=%.2f",
                    route,
                    status_code,
                    (perf_counter_ns() - started_at) / 1_000_000,
                )

        return wrapped

    return decorate


def _timed_serializer_data(serializer, route):
    if not settings.REQUEST_TIMING_ENABLED:
        return serializer.data

    started_at = perf_counter_ns()
    try:
        return serializer.data
    finally:
        timing_logger.info(
            "phase=serializer_data path=/%s duration_ms=%.2f",
            route,
            (perf_counter_ns() - started_at) / 1_000_000,
        )


def _safe_database_error_details(exception):
    details = {"sqlstate": None, "table": None, "column": None}
    current = exception
    visited = set()

    while current is not None and id(current) not in visited:
        visited.add(id(current))
        sqlstate = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None)
        diagnostics = getattr(current, "diag", None)

        if sqlstate and not details["sqlstate"]:
            details["sqlstate"] = sqlstate
        if diagnostics:
            details["table"] = details["table"] or getattr(diagnostics, "table_name", None) or None
            details["column"] = details["column"] or getattr(diagnostics, "column_name", None) or None
            primary_message = getattr(diagnostics, "message_primary", "") or ""
            if sqlstate == "42P01" and not details["table"]:
                match = _MISSING_TABLE.search(primary_message)
                if match:
                    details["table"] = match.group(1)
            elif sqlstate == "42703" and not details["column"]:
                match = _MISSING_COLUMN.search(primary_message)
                if match:
                    details["column"] = match.group(1)

        current = current.__cause__ or current.__context__

    return details


class RegisterUserView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Expected a JSON object."}, status=400)
        data = request.data.copy()
        email = data.get("email")
        password = data.get("password")
        if not isinstance(email, str) or not email.strip():
            return Response({"detail": "A valid email and password are required."}, status=400)
        if not isinstance(password, str) or not password:
            return Response({"detail": "Email and password are required."}, status=400)

        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError as exc:
            return Response({"email": list(exc.messages)}, status=400)
        if UserModel.objects.filter(email__iexact=email).exists():
            return Response({"detail": "A user with this email already exists."}, status=400)

        raw_username = data.get("username")
        username = raw_username.strip() if isinstance(raw_username, str) else ""
        username = (username or email.split("@")[0])[:150]
        candidate_user = UserModel(
            username=username,
            email=email,
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
        )
        try:
            validate_password(password, user=candidate_user)
        except ValidationError as exc:
            return Response({"password": list(exc.messages)}, status=400)
        user = UserModel.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
            phone=data.get("phone", ""),
            role=User.ROLE_USER,
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class CsrfTokenView(APIView):
    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response(
            {
                "detail": "CSRF cookie set.",
                "csrfToken": get_token(request),
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class TemporaryPasswordVerificationDiagnosticView(APIView):
    """Temporary benchmark; remove this view and its URL after investigation."""

    permission_classes = [IsAdminUser]

    @sensitive_variables("synthetic_password", "encoded_password")
    def post(self, _request):
        synthetic_password = secrets.token_urlsafe(32)
        encoded_password = make_password(synthetic_password)
        hasher = identify_hasher(encoded_password)

        verification_started_at = perf_counter_ns()
        process_started_at = process_time_ns()
        verification_succeeded = hasher.verify(synthetic_password, encoded_password)
        process_duration_ms = (
            process_time_ns() - process_started_at
        ) / 1_000_000
        verification_duration_ms = (
            perf_counter_ns() - verification_started_at
        ) / 1_000_000
        if not verification_succeeded:
            raise RuntimeError("Synthetic password verification failed.")

        diagnostic = {
            "verification_duration_ms": verification_duration_ms,
            "process_cpu_duration_ms": process_duration_ms,
            "hasher_algorithm": hasher.algorithm,
            "python_version": platform.python_version(),
            "openssl_version": ssl.OPENSSL_VERSION,
        }
        iterations = getattr(hasher, "iterations", None)
        if iterations is not None:
            diagnostic["iterations"] = iterations

        return Response(diagnostic)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle, LoginIPRateThrottle]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Expected a JSON object."}, status=400)
        email = request.data.get("email")
        password = request.data.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            return Response({"detail": "Email and password are required."}, status=400)
        try:
            if settings.REQUEST_TIMING_ENABLED:
                started_at = perf_counter_ns()
                try:
                    user = authenticate(request, email=email, password=password)
                finally:
                    timing_logger.info(
                        "login_phase=authenticate duration_ms=%.2f",
                        (perf_counter_ns() - started_at) / 1_000_000,
                    )
            else:
                user = authenticate(request, email=email, password=password)
            if user is None:
                return Response(
                    {"detail": "Invalid credentials."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            if settings.REQUEST_TIMING_ENABLED:
                started_at = perf_counter_ns()
                try:
                    login(request, user)
                finally:
                    timing_logger.info(
                        "login_phase=login duration_ms=%.2f",
                        (perf_counter_ns() - started_at) / 1_000_000,
                    )
            else:
                login(request, user)
            return Response(
                {"detail": "Login successful.", "user": UserSerializer(user).data}
            )
        except Exception as exc:
            frames = traceback.extract_tb(exc.__traceback__)
            frame_details = " <- ".join(
                f"{frame.filename}:{frame.lineno} in {frame.name}"
                for frame in frames
            )
            database_details = _safe_database_error_details(exc)
            logger.error(
                "Login processing failed; exception_class=%s; traceback=%s; "
                "db_sqlstate=%s; db_table=%s; db_column=%s",
                type(exc).__name__,
                frame_details,
                database_details["sqlstate"] or "-",
                database_details["table"] or "-",
                database_details["column"] or "-",
            )
            raise


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"detail": "Logout successful."})


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


def _create_managed_user_account(data, role):
    password = data.get("password")
    if not isinstance(password, str) or not password:
        return Response({"detail": "Password is required."}, status=400)

    raw_email = data.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) else ""
    if not email:
        return Response({"detail": "Email is required."}, status=400)
    try:
        validate_email(email)
    except ValidationError as exc:
        return Response({"email": list(exc.messages)}, status=400)
    if UserModel.objects.filter(email=email).exists():
        return Response({"email": ["A user with this email already exists."]}, status=400)
    try:
        validate_password(password)
    except ValidationError as exc:
        return Response({"password": list(exc.messages)}, status=400)

    username = data.get("username") or email.split("@")[0]
    username = username[:150]
    base_username = username
    suffix = 1
    while UserModel.objects.filter(username=username).exists():
        suffix_text = str(suffix)
        username = f"{base_username[:150 - len(suffix_text)]}{suffix_text}"
        suffix += 1

    user = UserModel.objects.create_user(
        username=username,
        email=email,
        password=password,
        role=role,
        first_name=data.get("first_name", ""),
        last_name=data.get("last_name", ""),
        phone=data.get("phone", ""),
    )
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class UserListView(APIView):
    permission_classes = [IsAdminUser]

    @_timed_view_handler("api/users/")
    def get(self, request):
        serializer = UserSerializer(UserModel.objects.all(), many=True)
        return Response(_timed_serializer_data(serializer, "api/users/"))

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Expected a JSON object."}, status=400)

        data = request.data.copy()
        role = data.get("role")
        # Explicitly whitelist only the two roles this endpoint is designed to create.
        # Do not derive the set from ROLE_CHOICES to avoid unintentionally accepting
        # any future roles added to that list.
        creatable_roles = {User.ROLE_USER, User.ROLE_ADMIN}
        if not isinstance(role, str) or role not in creatable_roles:
            return Response(
                {"role": [f"Select a supported role ({', '.join(sorted(creatable_roles))})."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return _create_managed_user_account(data, role)


class ResourceListCreateView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    @_timed_view_handler("api/resources/")
    def get(self, request):
        serializer = ResourceSerializer(Resource.objects.all(), many=True)
        return Response(_timed_serializer_data(serializer, "api/resources/"))

    def post(self, request):
        serializer = ResourceSerializer(data=request.data)
        if serializer.is_valid():
            resource = serializer.save()
            return Response(ResourceSerializer(resource).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ResourceDetailView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        return Response(ResourceSerializer(resource).data)

    def put(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        serializer = ResourceSerializer(resource, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        with transaction.atomic():
            resource = get_object_or_404(
                Resource.objects.select_for_update(),
                pk=pk,
            )
            resource.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResourceAvailabilityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, resource_id):
        resource = get_object_or_404(Resource, pk=resource_id)
        query_serializer = ResourceAvailabilityQuerySerializer(data=request.query_params)
        if not query_serializer.is_valid():
            return Response(query_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        bookings = Reservation.objects.filter(
            resource=resource,
            status__in=[Reservation.STATUS_CONFIRMED, Reservation.STATUS_PENDING],
        )
        start_date = query_serializer.validated_data.get("start_date")
        end_date = query_serializer.validated_data.get("end_date")

        if start_date and end_date:
            bookings = bookings.filter(reservation_date__lte=end_date).filter(
                Q(end_date__gte=start_date)
                | Q(end_date__isnull=True, reservation_date__gte=start_date)
            )

        payload_bookings = []
        for booking in bookings.only(
            "reservation_date",
            "end_date",
            "start_time",
            "end_time",
            "is_full_day",
            "status",
        ):
            original_start = booking.reservation_date
            original_end = booking.end_date or booking.reservation_date
            booking_start = max(original_start, start_date) if start_date else original_start
            booking_end = min(original_end, end_date) if end_date else original_end
            current_date = booking_start
            while current_date <= booking_end:
                if booking.is_full_day:
                    start_time = end_time = None
                else:
                    if current_date == original_end and booking.end_time == time.min:
                        current_date += timedelta(days=1)
                        continue
                    start_time = (
                        booking.start_time.strftime("%H:%M")
                        if current_date == original_start
                        else "00:00"
                    )
                    end_time = (
                        booking.end_time.strftime("%H:%M")
                        if current_date == original_end
                        else "24:00"
                    )
                payload_bookings.append(
                    {
                        "date": current_date.isoformat(),
                        "start_time": start_time,
                        "end_time": end_time,
                        "is_full_day": booking.is_full_day,
                        "status": booking.status,
                    }
                )
                current_date += timedelta(days=1)

        payload = {
            "resource_id": resource.id,
            "resource_name": resource.name,
            "default_window": {
                "start": resource.default_start_time.strftime("%H:%M"),
                "end": resource.default_end_time.strftime("%H:%M"),
            },
            "bookings": payload_bookings,
        }
        return Response(payload)


class ResourceConstraintBulkListView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request):
        constraints = ResourceAvailabilityConstraint.objects.all()
        return Response(
            ResourceAvailabilityConstraintSerializer(constraints, many=True).data
        )


class ResourceConstraintListCreateView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request, resource_id):
        resource = get_object_or_404(Resource, pk=resource_id)
        constraints = resource.constraints.all()
        return Response(ResourceAvailabilityConstraintSerializer(constraints, many=True).data)

    def post(self, request, resource_id):
        resource = get_object_or_404(Resource, pk=resource_id)
        serializer = ResourceAvailabilityConstraintSerializer(data={**request.data, "resource": resource.id})
        if serializer.is_valid():
            constraint = serializer.save(resource=resource)
            return Response(ResourceAvailabilityConstraintSerializer(constraint).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ResourceConstraintDetailView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request, pk):
        constraint = get_object_or_404(ResourceAvailabilityConstraint, pk=pk)
        return Response(ResourceAvailabilityConstraintSerializer(constraint).data)

    def put(self, request, pk):
        constraint = get_object_or_404(ResourceAvailabilityConstraint, pk=pk)
        serializer = ResourceAvailabilityConstraintSerializer(constraint, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        constraint = get_object_or_404(ResourceAvailabilityConstraint, pk=pk)
        constraint.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReservationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role == User.ROLE_ADMIN:
            reservations = Reservation.objects.select_related("user", "resource").all()
        else:
            reservations = Reservation.objects.filter(user=request.user).select_related("user", "resource")
        return Response(ReservationSerializer(reservations, many=True).data)

    def post(self, request):
        serializer = ReservationWriteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                reservation = create_or_update_reservation(
                    user=request.user,
                    resource_id=serializer.validated_data["resource"].id,
                    reservation_date=serializer.validated_data.get("reservation_date")
                    or serializer.validated_data.get("start_date"),
                    start_time=serializer.validated_data.get("start_time"),
                    end_time=serializer.validated_data.get("end_time"),
                    is_full_day=serializer.validated_data.get("is_full_day", False),
                    notes=serializer.validated_data.get("notes", ""),
                    end_date=serializer.validated_data.get("end_date"),
                )
        except (PermissionError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ReservationSerializer(reservation).data, status=status.HTTP_201_CREATED)


class ReservationDetailView(APIView):
    permission_classes = [IsOwnerOrAdmin]

    def get(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        self.check_object_permissions(request, reservation)
        return Response(ReservationSerializer(reservation).data)

    def put(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        self.check_object_permissions(request, reservation)
        serializer = ReservationWriteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                updated = create_or_update_reservation(
                    reservation=reservation,
                    user=request.user,
                    resource_id=serializer.validated_data["resource"].id,
                    reservation_date=serializer.validated_data.get("reservation_date")
                    or serializer.validated_data.get("start_date"),
                    start_time=serializer.validated_data.get("start_time"),
                    end_time=serializer.validated_data.get("end_time"),
                    is_full_day=serializer.validated_data.get("is_full_day", False),
                    notes=serializer.validated_data.get("notes", ""),
                    end_date=serializer.validated_data.get("end_date"),
                )
        except (PermissionError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ReservationSerializer(updated).data)

    def delete(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        self.check_object_permissions(request, reservation)
        try:
            with transaction.atomic():
                cancel_reservation(reservation, request.user, admin_override=request.user.role == User.ROLE_ADMIN)
        except (PermissionError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"detail": "Reservation cancelled and permanently removed."},
            status=status.HTTP_200_OK,
        )


class AdminReservationListView(APIView):
    permission_classes = [IsAdminUser]

    @_timed_view_handler("api/admin/reservations/")
    def get(self, request):
        today = timezone.localdate()
        current_time = timezone.localtime().time()
        timed_reservations_not_ended = (
            Q(end_date__gt=today)
            | Q(end_date=today, end_time__gt=current_time)
            | Q(
                end_date__isnull=True,
                reservation_date__gt=today,
            )
            | Q(
                end_date__isnull=True,
                reservation_date=today,
                end_time__gt=current_time,
            )
        )
        full_day_reservations_not_ended = (
            Q(end_date__gte=today)
            | Q(end_date__isnull=True, reservation_date__gte=today)
        )
        reservations = (
            Reservation.objects.select_related("user", "resource")
            .filter(
                status__in=[
                    Reservation.STATUS_CONFIRMED,
                    Reservation.STATUS_PENDING,
                ]
            )
            .filter(
                Q(is_full_day=True, reservation_date__lte=today)
                & full_day_reservations_not_ended
                | Q(is_full_day=False)
                & timed_reservations_not_ended
            )
        )
        serializer = ReservationSerializer(reservations, many=True)
        return Response(
            _timed_serializer_data(serializer, "api/admin/reservations/")
        )


class AdminReservationDeleteView(APIView):
    permission_classes = [IsAdminUser]

    def delete(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        try:
            with transaction.atomic():
                cancel_reservation(reservation, request.user, admin_override=True)
        except (PermissionError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"detail": "Reservation cancelled and permanently removed by admin."},
            status=status.HTTP_200_OK,
        )


class AdminListCreateView(APIView):
    permission_classes = [IsAdminUser]

    @_timed_view_handler("api/admins/")
    def get(self, request):
        admins = UserModel.objects.filter(role=User.ROLE_ADMIN)
        serializer = UserSerializer(admins, many=True)
        return Response(_timed_serializer_data(serializer, "api/admins/"))

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Expected a JSON object."}, status=400)
        return _create_managed_user_account(
            request.data.copy(),
            User.ROLE_ADMIN,
        )


class AdminDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request, pk):
        admin = get_object_or_404(UserModel, pk=pk, role=User.ROLE_ADMIN)
        return Response(UserSerializer(admin).data)

    def put(self, request, pk):
        admin = get_object_or_404(UserModel, pk=pk, role=User.ROLE_ADMIN)
        serializer = AdminUpdateSerializer(admin, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(UserSerializer(admin).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        with transaction.atomic():
            active_admins = list(
                UserModel.objects.select_for_update()
                .filter(role=User.ROLE_ADMIN, is_active=True)
                .order_by("pk")
            )
            admin = get_object_or_404(
                UserModel.objects.select_for_update(),
                pk=pk,
                role=User.ROLE_ADMIN,
            )
            if admin.is_active and len(active_admins) <= 1:
                return Response(
                    {"detail": "The last active administrator cannot be deleted."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if Reservation.objects.filter(user=admin).exists():
                return Response(
                    {
                        "detail": "This administrator has reservation history and cannot be deleted."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if admin.pk == request.user.pk:
                return Response(
                    {"detail": "You cannot delete the administrator account currently in use."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            admin.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
