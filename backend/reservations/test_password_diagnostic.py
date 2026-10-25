import platform
import ssl
from unittest.mock import patch

from django.contrib.auth.hashers import PBKDF2PasswordHasher
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import User


@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class TemporaryPasswordVerificationDiagnosticTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="diagnostic-admin",
            email="diagnostic-admin@example.test",
            password="test-password",
            role=User.ROLE_ADMIN,
        )
        self.user = User.objects.create_user(
            username="diagnostic-user",
            email="diagnostic-user@example.test",
            password="test-password",
            role=User.ROLE_USER,
        )
        self.inactive_admin = User.objects.create_user(
            username="inactive-diagnostic-admin",
            email="inactive-diagnostic-admin@example.test",
            password="test-password",
            role=User.ROLE_ADMIN,
            is_active=False,
        )
        self.url = reverse("temporary-password-diagnostic")

    def test_only_authenticated_active_administrators_are_authorized(self):
        anonymous_response = APIClient().post(self.url, {}, format="json")
        self.assertEqual(anonymous_response.status_code, 403)

        user_client = APIClient()
        user_client.force_login(self.user)
        user_response = user_client.post(self.url, {}, format="json")
        self.assertEqual(user_response.status_code, 403)

        inactive_admin_client = APIClient()
        inactive_admin_client.force_authenticate(user=self.inactive_admin)
        inactive_admin_response = inactive_admin_client.post(
            self.url,
            {},
            format="json",
        )
        self.assertEqual(inactive_admin_response.status_code, 403)

    @override_settings(
        PASSWORD_HASHERS=["django.contrib.auth.hashers.PBKDF2PasswordHasher"],
    )
    def test_session_csrf_and_single_verification_return_only_diagnostic_metadata(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin)

        missing_csrf_response = client.post(self.url, {}, format="json")
        self.assertEqual(missing_csrf_response.status_code, 403)

        csrf_response = client.get(reverse("auth-csrf"))
        self.assertEqual(csrf_response.status_code, 200)
        csrf_token = csrf_response.data["csrfToken"]

        verification_inputs = []
        original_verify = PBKDF2PasswordHasher.verify

        def record_verify(hasher, password, encoded):
            verification_inputs.append((password, encoded))
            return original_verify(hasher, password, encoded)

        with (
            patch.object(PBKDF2PasswordHasher, "iterations", 10),
            patch.object(PBKDF2PasswordHasher, "verify", record_verify),
            patch("reservations.views.process_time_ns", side_effect=[100, 500]),
        ):
            response = client.post(
                self.url,
                {"password": "client-supplied-value", "runs": 5},
                format="json",
                HTTP_X_CSRFTOKEN=csrf_token,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(verification_inputs), 1)
        synthetic_password, encoded_password = verification_inputs[0]
        self.assertNotEqual(synthetic_password, "client-supplied-value")

        self.assertEqual(
            set(response.data),
            {
                "verification_duration_ms",
                "process_cpu_duration_ms",
                "hasher_algorithm",
                "iterations",
                "python_version",
                "openssl_version",
            },
        )
        self.assertIsInstance(response.data["verification_duration_ms"], float)
        self.assertGreaterEqual(response.data["verification_duration_ms"], 0)
        self.assertEqual(response.data["process_cpu_duration_ms"], 0.0004)
        self.assertEqual(response.data["hasher_algorithm"], "pbkdf2_sha256")
        self.assertEqual(response.data["iterations"], 10)
        self.assertEqual(response.data["python_version"], platform.python_version())
        self.assertEqual(response.data["openssl_version"], ssl.OPENSSL_VERSION)

        response_body = response.content.decode()
        self.assertNotIn(synthetic_password, response_body)
        self.assertNotIn(encoded_password, response_body)
