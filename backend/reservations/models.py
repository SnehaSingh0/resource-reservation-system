from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    ROLE_USER = "USER"
    ROLE_ADMIN = "ADMIN"
    ROLE_CHOICES = (
        (ROLE_USER, "User"),
        (ROLE_ADMIN, "Admin"),
    )

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True, default="")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_USER)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username", "first_name", "last_name"]

    def save(self, *args, **kwargs):
        if not self.username:
            base_username = self.email.split("@")[0] if self.email else "user"
            self.username = base_username
        if not self.created_at:
            self.created_at = timezone.now()
        self.updated_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.email} ({self.role})"


class Resource(models.Model):
    name = models.CharField(max_length=200)
    resource_type = models.CharField(max_length=100, default="generic")
    description = models.TextField(blank=True, default="")
    location = models.CharField(max_length=200, blank=True, default="")
    is_active = models.BooleanField(default=True)
    default_start_time = models.TimeField(default="09:00:00")
    default_end_time = models.TimeField(default="18:00:00")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ResourceAvailabilityConstraint(models.Model):
    resource = models.ForeignKey(Resource, on_delete=models.CASCADE, related_name="constraints")
    day_of_week = models.IntegerField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    is_full_day = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["day_of_week", "start_time"]

    def __str__(self):
        return f"{self.resource.name} {self.day_of_week} {self.start_time}-{self.end_time}"


class Reservation(models.Model):
    STATUS_PENDING = "PENDING"
    STATUS_CONFIRMED = "CONFIRMED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = (
        (STATUS_PENDING, "Pending"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_CANCELLED, "Cancelled"),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reservations")
    resource = models.ForeignKey(Resource, on_delete=models.CASCADE, related_name="reservations")
    reservation_date = models.DateField()
    end_date = models.DateField(null=True, blank=True, default=None)
    start_time = models.TimeField(null=True, blank=True, default=None)
    end_time = models.TimeField(null=True, blank=True, default=None)
    is_full_day = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_CONFIRMED)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["reservation_date", "start_time"]

    def __str__(self):
        end_label = self.end_date or self.reservation_date
        return f"{self.user.email} -> {self.resource.name} ({self.reservation_date} to {end_label})"
