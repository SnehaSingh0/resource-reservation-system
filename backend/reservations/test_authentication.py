from unittest.mock import patch

from django.contrib.auth.backends import (
    check_password_with_timing_attack_mitigation,
)
from django.contrib.auth.hashers import identify_hasher, make_password
from django.test import TestCase, override_settings

from .authentication import TimedModelBackend
from .models import User


class TimedModelBackendTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username="timing-user",
            email="timing-user@example.test",
            password="strong-test-password",
        )
        cls.inactive_user = User.objects.create_user(
            username="inactive-timing-user",
            email="inactive-timing-user@example.test",
            password="strong-test-password",
            is_active=False,
        )

    def setUp(self):
        self.backend = TimedModelBackend()

    @override_settings(REQUEST_TIMING_ENABLED=True)
    def test_successful_authentication_logs_separate_safe_timings(self):
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="timing-user@example.test",
                password="strong-test-password",
            )

        self.assertEqual(user, self.user)
        self.assert_timing_log_is_safe(captured.output)

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch("reservations.authentication.process_time_ns", side_effect=[0, 400_000_000])
    @patch(
        "reservations.authentication.perf_counter_ns",
        side_effect=[
            0,
            1_000_000,
            3_000_000,
            10_000_000,
            610_000_000,
            700_000_000,
        ],
    )
    @patch(
        "reservations.authentication.check_password_with_timing_attack_mitigation",
        return_value=True,
    )
    def test_logs_exact_wall_and_process_cpu_password_check_durations(
        self,
        password_check,
        _perf_counter,
        _process_time,
    ):
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="timing-user@example.test",
                password="correct-test-password",
            )

        self.assertEqual(user, self.user)
        password_check.assert_called_once_with(self.user, "correct-test-password")
        self.assertIn(
            "user_lookup_ms=2.00 password_check_ms=600.00 "
            "password_check_cpu_ms=400.00 backend_total_ms=700.00",
            captured.output[0],
        )

    @override_settings(REQUEST_TIMING_ENABLED=True)
    def test_incorrect_password_is_rejected_and_timed(self):
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="timing-user@example.test",
                password="incorrect-password",
            )

        self.assertIsNone(user)
        self.assert_timing_log_is_safe(captured.output)

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch(
        "reservations.authentication.check_password_with_timing_attack_mitigation",
        wraps=check_password_with_timing_attack_mitigation,
    )
    def test_unknown_email_runs_django_dummy_password_check(self, password_check):
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="unknown-timing-user@example.test",
                password="incorrect-password",
            )

        self.assertIsNone(user)
        self.assertIsNone(password_check.call_args.args[0])
        self.assert_timing_log_is_safe(captured.output)

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch(
        "reservations.authentication.check_password_with_timing_attack_mitigation",
        wraps=check_password_with_timing_attack_mitigation,
    )
    def test_inactive_user_password_is_checked_then_authentication_rejected(
        self,
        password_check,
    ):
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="inactive-timing-user@example.test",
                password="strong-test-password",
            )

        self.assertIsNone(user)
        self.assertEqual(password_check.call_args.args[0], self.inactive_user)
        self.assert_timing_log_is_safe(captured.output)

    @override_settings(
        REQUEST_TIMING_ENABLED=True,
        PASSWORD_HASHERS=[
            "django.contrib.auth.hashers.PBKDF2PasswordHasher",
            "django.contrib.auth.hashers.MD5PasswordHasher",
        ],
    )
    def test_successful_authentication_upgrades_legacy_password_hash(self):
        self.user.password = make_password(
            "strong-test-password",
            hasher="md5",
        )
        self.user.save(update_fields=["password"])
        legacy_hash = self.user.password

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            user = self.backend.authenticate(
                None,
                email="timing-user@example.test",
                password="strong-test-password",
            )

        self.user.refresh_from_db()
        self.assertEqual(user, self.user)
        self.assertEqual(
            identify_hasher(self.user.password).algorithm,
            "pbkdf2_sha256",
        )
        self.assertNotEqual(self.user.password, legacy_hash)
        self.assert_timing_log_is_safe(captured.output)
        self.assertNotIn(legacy_hash, "\n".join(captured.output))

    @override_settings(REQUEST_TIMING_ENABLED=False)
    @patch("reservations.authentication.timing_logger.info")
    def test_disabled_timing_delegates_without_detailed_logs(self, timing_info):
        user = self.backend.authenticate(
            None,
            email="timing-user@example.test",
            password="strong-test-password",
        )

        self.assertEqual(user, self.user)
        timing_info.assert_not_called()

    def assert_timing_log_is_safe(self, output):
        log_line = "\n".join(output)
        self.assertIn("user_lookup_ms=", log_line)
        self.assertIn("password_check_ms=", log_line)
        self.assertIn("password_check_cpu_ms=", log_line)
        self.assertIn("backend_total_ms=", log_line)
        self.assertNotIn("timing-user@example.test", log_line)
        self.assertNotIn("unknown-timing-user@example.test", log_line)
        self.assertNotIn("inactive-timing-user@example.test", log_line)
        self.assertNotIn("timing-user", log_line)
        self.assertNotIn("inactive-timing-user", log_line)
        self.assertNotIn("strong-test-password", log_line)
        self.assertNotIn("incorrect-password", log_line)
