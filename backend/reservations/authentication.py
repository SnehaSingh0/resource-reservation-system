import logging
from time import perf_counter_ns

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import (
    ModelBackend,
    check_password_with_timing_attack_mitigation,
)
from django.views.decorators.debug import sensitive_variables


timing_logger = logging.getLogger("reservations.request_timing")


class TimedModelBackend(ModelBackend):
    @sensitive_variables("password")
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not settings.REQUEST_TIMING_ENABLED:
            return super().authenticate(
                request,
                username=username,
                password=password,
                **kwargs,
            )

        total_started_at = perf_counter_ns()
        lookup_duration_ns = 0
        password_duration_ns = 0
        try:
            user_model = get_user_model()
            if username is None:
                username = kwargs.get(user_model.USERNAME_FIELD)
            if username is None or password is None:
                return

            lookup_started_at = perf_counter_ns()
            try:
                user = user_model._default_manager.get_by_natural_key(username)
            except user_model.DoesNotExist:
                user = None
            finally:
                lookup_duration_ns = perf_counter_ns() - lookup_started_at

            password_started_at = perf_counter_ns()
            try:
                password_valid = check_password_with_timing_attack_mitigation(
                    user,
                    password,
                )
            finally:
                password_duration_ns = perf_counter_ns() - password_started_at

            if password_valid and self.user_can_authenticate(user):
                return user
        finally:
            total_duration_ns = perf_counter_ns() - total_started_at
            timing_logger.info(
                "login_phase=authenticate_breakdown "
                "user_lookup_ms=%.2f password_check_ms=%.2f backend_total_ms=%.2f",
                lookup_duration_ns / 1_000_000,
                password_duration_ns / 1_000_000,
                total_duration_ns / 1_000_000,
            )
