from __future__ import annotations

import logging
import traceback

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.db import transaction
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Reservation, Resource, ResourceAvailabilityConstraint, User
from .permissions import IsAdminOrReadOnly, IsAdminUser, IsOwnerOrAdmin
from .serializers import (
    ReservationSerializer,
    ReservationWriteSerializer,
    ResourceAvailabilityConstraintSerializer,
    ResourceAvailabilityQuerySerializer,
    ResourceSerializer,
    UserSerializer,
)
from .services import cancel_reservation, create_or_update_reservation
from .throttles import LoginIPRateThrottle, LoginRateThrottle

UserModel = get_user_model()
logger = logging.getLogger(__name__)


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
            user = authenticate(request, email=email, password=password)
            if user is None:
                return Response(
                    {"detail": "Invalid credentials."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
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
            logger.error(
                "Login processing failed; exception_class=%s; traceback=%s",
                type(exc).__name__,
                frame_details,
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


class UserListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(UserSerializer(UserModel.objects.all(), many=True).data)


class ResourceListCreateView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request):
        return Response(ResourceSerializer(Resource.objects.all(), many=True).data)

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
        resource = get_object_or_404(Resource, pk=pk)
        if Reservation.objects.filter(resource=resource).exists():
            return Response(
                {"detail": "This resource has reservation history and cannot be deleted. Deactivate it instead."},
                status=status.HTTP_400_BAD_REQUEST,
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
            bookings = bookings.filter(reservation_date__range=(start_date, end_date))
        payload = {
            "resource_id": resource.id,
            "resource_name": resource.name,
            "default_window": {
                "start": resource.default_start_time.strftime("%H:%M"),
                "end": resource.default_end_time.strftime("%H:%M"),
            },
            "bookings": [
                {
                    "date": booking.reservation_date.isoformat(),
                    "start_time": booking.start_time.strftime("%H:%M"),
                    "end_time": booking.end_time.strftime("%H:%M"),
                    "status": booking.status,
                }
                for booking in bookings
            ],
        }
        return Response(payload)


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
                    reservation_date=serializer.validated_data["reservation_date"],
                    start_time=serializer.validated_data["start_time"],
                    end_time=serializer.validated_data["end_time"],
                    notes=serializer.validated_data.get("notes", ""),
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
                    reservation_date=serializer.validated_data["reservation_date"],
                    start_time=serializer.validated_data["start_time"],
                    end_time=serializer.validated_data["end_time"],
                    notes=serializer.validated_data.get("notes", ""),
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
        return Response({"detail": "Reservation cancelled."}, status=status.HTTP_200_OK)


class AdminReservationListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        reservations = Reservation.objects.select_related("user", "resource").all()
        return Response(ReservationSerializer(reservations, many=True).data)


class AdminReservationDeleteView(APIView):
    permission_classes = [IsAdminUser]

    def delete(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        try:
            with transaction.atomic():
                cancel_reservation(reservation, request.user, admin_override=True)
        except (PermissionError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Reservation cancelled by admin."}, status=status.HTTP_200_OK)


class AdminListCreateView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        admins = UserModel.objects.filter(role=User.ROLE_ADMIN)
        return Response(UserSerializer(admins, many=True).data)

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Expected a JSON object."}, status=400)
        data = request.data.copy()
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

        admin = UserModel.objects.create_user(
            username=username,
            email=email,
            password=password,
            role=User.ROLE_ADMIN,
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
            phone=data.get("phone", ""),
        )
        return Response(UserSerializer(admin).data, status=status.HTTP_201_CREATED)


class AdminDetailView(APIView):
    permission_classes = [IsAdminUser]

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
