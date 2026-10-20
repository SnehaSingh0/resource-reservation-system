from __future__ import annotations

from datetime import time

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Reservation, Resource, ResourceAvailabilityConstraint

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "phone",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "role"]

    def validate_email(self, value):
        value = value.strip().lower()
        if not value:
            raise serializers.ValidationError("Email is required.")
        return value


class AdminUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["email", "first_name", "last_name", "phone"]

    def validate_email(self, value):
        value = value.strip().lower()
        if not value:
            raise serializers.ValidationError("Email is required.")
        existing = User.objects.filter(email__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = [
            "id",
            "name",
            "resource_type",
            "description",
            "location",
            "is_active",
            "default_start_time",
            "default_end_time",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        start_time = attrs.get(
            "default_start_time",
            getattr(self.instance, "default_start_time", None),
        )
        end_time = attrs.get(
            "default_end_time",
            getattr(self.instance, "default_end_time", None),
        )
        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError(
                {"default_end_time": "End time must be later than start time."}
            )
        return attrs


class ResourceAvailabilityConstraintSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResourceAvailabilityConstraint
        fields = [
            "id",
            "resource",
            "day_of_week",
            "start_time",
            "end_time",
            "is_full_day",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        day_of_week = attrs.get(
            "day_of_week",
            getattr(self.instance, "day_of_week", None),
        )
        start_time = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end_time = attrs.get("end_time", getattr(self.instance, "end_time", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        is_full_day = attrs.get(
            "is_full_day",
            getattr(self.instance, "is_full_day", False),
        )
        resource = attrs.get("resource", getattr(self.instance, "resource", None))

        if day_of_week is not None and not 0 <= day_of_week <= 6:
            raise serializers.ValidationError(
                {"day_of_week": "Day of week must be between 0 (Monday) and 6 (Sunday)."}
            )
        if is_full_day:
            attrs["start_time"] = time.min
            attrs["end_time"] = time(23, 59)
            start_time = attrs["start_time"]
            end_time = attrs["end_time"]
        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError(
                {"end_time": "End time must be later than start time."}
            )

        if resource and day_of_week is not None and start_time and end_time and is_active:
            existing_constraints = ResourceAvailabilityConstraint.objects.filter(
                resource=resource,
                day_of_week=day_of_week,
                is_active=True,
            )
            if self.instance:
                existing_constraints = existing_constraints.exclude(pk=self.instance.pk)
            if existing_constraints.filter(
                start_time__lt=end_time,
                end_time__gt=start_time,
            ).exists():
                raise serializers.ValidationError(
                    {"start_time": "This availability window overlaps another active window."}
                )
        return attrs


class ResourceAvailabilityQuerySerializer(serializers.Serializer):
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")
        if (start_date is None) != (end_date is None):
            raise serializers.ValidationError(
                "Both start_date and end_date must be provided together."
            )
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError(
                {"end_date": "End date must be on or after start date."}
            )
        return attrs


class ReservationSerializer(serializers.ModelSerializer):
    resource_name = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()

    class Meta:
        model = Reservation
        fields = [
            "id",
            "user",
            "user_email",
            "resource",
            "resource_name",
            "reservation_date",
            "end_date",
            "start_time",
            "end_time",
            "is_full_day",
            "status",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "user_email", "resource_name", "created_at", "updated_at"]

    def get_resource_name(self, obj):
        return obj.resource.name

    def get_user_email(self, obj):
        return obj.user.email


class ReservationWriteSerializer(serializers.ModelSerializer):
    reservation_date = serializers.DateField(required=False)
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    is_full_day = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = Reservation
        fields = [
            "resource",
            "reservation_date",
            "start_date",
            "end_date",
            "start_time",
            "end_time",
            "is_full_day",
            "notes",
        ]

    def validate(self, attrs):
        reservation_date = attrs.get("reservation_date")
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")

        if reservation_date is None:
            reservation_date = start_date
        if reservation_date is None:
            raise serializers.ValidationError(
                {"reservation_date": "A reservation date is required."}
            )

        if start_date is not None and end_date is None:
            raise serializers.ValidationError(
                {"end_date": "An end date is required when start_date is provided."}
            )

        attrs["reservation_date"] = reservation_date
        if end_date is None and reservation_date is not None:
            end_date = reservation_date
            attrs["end_date"] = reservation_date
        if reservation_date is not None and end_date is not None and end_date < reservation_date:
            raise serializers.ValidationError({"end_date": "End date must be on or after start date."})

        if attrs.get("is_full_day", False):
            attrs["start_time"] = None
            attrs["end_time"] = None
            return attrs

        start = attrs.get("start_time")
        end = attrs.get("end_time")
        if start is None or end is None:
            raise serializers.ValidationError(
                {
                    "start_time": "Start and end times are required for a timed reservation.",
                    "end_time": "Start and end times are required for a timed reservation.",
                }
            )
        if start and end and reservation_date == end_date and start >= end:
            raise serializers.ValidationError({"end_time": "End time must be later than start time."})
        return attrs
