from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdminUser(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and request.user.role == "ADMIN"
        )


class IsOwnerOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.role == "ADMIN":
            return True
        if request.method in SAFE_METHODS:
            return getattr(obj, "user", None) == request.user
        return getattr(obj, "user", None) == request.user


class IsAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(
                request.user
                and request.user.is_authenticated
                and request.user.is_active
            )
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and request.user.role == "ADMIN"
        )
