import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, time
from threading import Barrier
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.core.cache import cache
from django.db import ProgrammingError
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import Reservation, Resource, User
from .services import create_or_update_reservation
from .throttles import LoginIPRateThrottle, LoginRateThrottle


class ReservationBusinessRulesTests(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(
            username="user1",
            email="user1@example.com",
            password="secretpass123",
            role=User.ROLE_USER,
        )
        self.admin = User.objects.create_user(
            username="admin1",
            email="admin1@example.com",
            password="secretpass123",
            role=User.ROLE_ADMIN,
        )
        self.resource = Resource.objects.create(
            name="Board Room",
            resource_type="room",
            default_start_time=time(9, 0),
            default_end_time=time(18, 0),
        )

    def test_register_user_endpoint_creates_account(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "newuser@example.com",
                "password": "secretpass123",
                "first_name": "New",
                "last_name": "User",
                "role": User.ROLE_ADMIN,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        registered_user = User.objects.get(email="newuser@example.com")
        self.assertEqual(registered_user.role, User.ROLE_USER)

    def test_registration_rejects_invalid_email_without_creating_user(self):
        response = self.client.post(
            "/api/auth/register/",
            {"email": "not-an-email", "password": "secretpass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email="not-an-email").exists())

    def test_registration_rejects_non_object_payload(self):
        response = self.client.post(
            "/api/auth/register/",
            ["not", "an", "object"],
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_user_cannot_change_role_through_profile_endpoint(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.patch(
            "/api/users/me/",
            {"role": User.ROLE_ADMIN},
            format="json",
        )
        self.assertEqual(response.status_code, 405)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, User.ROLE_USER)

    @override_settings(DEBUG=True)
    @patch.dict(
        "os.environ",
        {
            "DEMO_ADMIN_EMAIL": "development-admin@example.com",
            "DEMO_ADMIN_PASSWORD": "Reservation-Demo-Admin-2026!",
        },
    )
    def test_demo_admin_command_creates_and_updates_authenticatable_admin(self):
        output = io.StringIO()
        call_command("configure_demo_admin", stdout=output)
        admin = User.objects.get(email="development-admin@example.com")
        self.assertEqual(admin.role, User.ROLE_ADMIN)
        self.assertTrue(admin.is_active)
        self.assertTrue(admin.check_password("Reservation-Demo-Admin-2026!"))
        self.assertIn("Created development Admin account", output.getvalue())

        admin.role = User.ROLE_USER
        admin.set_password("Old-Password-2026!")
        admin.save()
        output = io.StringIO()
        call_command("configure_demo_admin", stdout=output)
        admin.refresh_from_db()
        self.assertEqual(User.objects.filter(email="development-admin@example.com").count(), 1)
        self.assertEqual(admin.role, User.ROLE_ADMIN)
        self.assertTrue(admin.check_password("Reservation-Demo-Admin-2026!"))
        self.assertIn("Updated development Admin account", output.getvalue())

        csrf_response = self.client.get("/api/auth/csrf/")
        self.assertEqual(csrf_response.status_code, 200)
        login_response = self.client.post(
            "/api/auth/login/",
            {
                "email": "development-admin@example.com",
                "password": "Reservation-Demo-Admin-2026!",
            },
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(login_response.data["user"]["role"], User.ROLE_ADMIN)

    def get_csrf_token(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrfToken", response.data)
        self.assertTrue(response.cookies.get("csrftoken"))
        return response.data["csrfToken"]

    def login_user(self, password="secretpass123"):
        csrf_token = self.get_csrf_token()
        return self.client.post(
            "/api/auth/login/",
            {"email": self.user.email, "password": password},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

    def test_valid_credentials_establish_authenticated_session(self):
        response = self.login_user()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["role"], User.ROLE_USER)

        current_user_response = self.client.get("/api/users/me/")
        self.assertEqual(current_user_response.status_code, 200)
        self.assertEqual(current_user_response.data["email"], self.user.email)

    def test_invalid_credentials_are_rejected(self):
        response = self.login_user(password="incorrect-password")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], "Invalid credentials.")

    @patch.object(LoginRateThrottle, "THROTTLE_RATES", {"login": "1/minute"})
    @patch.object(LoginIPRateThrottle, "THROTTLE_RATES", {"login_ip": "1/minute"})
    def test_login_attempts_are_rate_limited(self):
        cache.clear()
        csrf_token = self.get_csrf_token()
        payload = {"email": "limited-login@example.com", "password": "wrong-password"}
        first_response = self.client.post(
            "/api/auth/login/",
            payload,
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        second_response = self.client.post(
            "/api/auth/login/",
            payload,
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(first_response.status_code, 401)
        self.assertEqual(second_response.status_code, 429)
        cache.clear()

    def test_login_requires_csrf_token(self):
        response = self.client.post(
            "/api/auth/login/",
            {"email": self.user.email, "password": "secretpass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unexpected_login_exception_logs_only_class_and_traceback(self):
        csrf_token = self.get_csrf_token()
        password = "private-password-sentinel"
        with self.assertLogs("reservations.views", level="ERROR") as captured:
            with self.assertRaisesRegex(RuntimeError, "private-exception-sentinel"):
                with patch(
                    "reservations.views.authenticate",
                    side_effect=RuntimeError("private-exception-sentinel"),
                ):
                    self.client.post(
                        "/api/auth/login/",
                        {"email": self.user.email, "password": password},
                        format="json",
                        HTTP_X_CSRFTOKEN=csrf_token,
                    )

        log_output = "\n".join(captured.output)
        self.assertIn("exception_class=RuntimeError", log_output)
        self.assertIn("in post", log_output)
        self.assertNotIn("private-exception-sentinel", log_output)
        self.assertNotIn(password, log_output)

    def test_programming_error_logs_only_safe_postgres_diagnostics(self):
        csrf_token = self.get_csrf_token()
        password = "private-password-sentinel"
        driver_error = RuntimeError("private-driver-error-sentinel")
        driver_error.sqlstate = "42P01"
        driver_error.diag = SimpleNamespace(
            table_name="",
            column_name="",
            message_primary='relation "reservations_user" does not exist',
        )
        database_error = ProgrammingError("private-database-error-sentinel")
        database_error.__cause__ = driver_error

        with self.assertLogs("reservations.views", level="ERROR") as captured:
            with self.assertRaises(ProgrammingError):
                with patch(
                    "reservations.views.authenticate",
                    side_effect=database_error,
                ):
                    self.client.post(
                        "/api/auth/login/",
                        {"email": self.user.email, "password": password},
                        format="json",
                        HTTP_X_CSRFTOKEN=csrf_token,
                    )

        log_output = "\n".join(captured.output)
        self.assertIn("exception_class=ProgrammingError", log_output)
        self.assertIn("db_sqlstate=42P01", log_output)
        self.assertIn("db_table=reservations_user", log_output)
        self.assertIn("db_column=-", log_output)
        self.assertNotIn("private-database-error-sentinel", log_output)
        self.assertNotIn("private-driver-error-sentinel", log_output)
        self.assertNotIn(password, log_output)

    def test_safe_database_error_details_identify_missing_column(self):
        from .views import _safe_database_error_details

        database_error = RuntimeError("private-error-sentinel")
        database_error.sqlstate = "42703"
        database_error.diag = SimpleNamespace(
            table_name="",
            column_name="",
            message_primary='column "reservations_user.created_at" does not exist',
        )

        details = _safe_database_error_details(database_error)

        self.assertEqual(details["sqlstate"], "42703")
        self.assertEqual(details["column"], "reservations_user.created_at")
        self.assertIsNone(details["table"])
        self.assertNotIn("private-error-sentinel", str(details))

    def test_authenticated_unsafe_reservation_requests_require_csrf(self):
        login_response = self.login_user()
        self.assertEqual(login_response.status_code, 200)
        reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        reservation_data = {
            "resource": self.resource.id,
            "reservation_date": "2025-01-15",
            "start_time": "14:00",
            "end_time": "15:00",
        }

        requests = (
            ("POST", "/api/reservations/", reservation_data),
            ("PUT", f"/api/reservations/{reservation.id}/", reservation_data),
            ("DELETE", f"/api/reservations/{reservation.id}/", {}),
        )
        for method, url, data in requests:
            with self.subTest(method=method):
                response = self.client.generic(
                    method,
                    url,
                    data=json.dumps(data),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 403)

    def test_logout_ends_authenticated_session(self):
        login_response = self.login_user()
        self.assertEqual(login_response.status_code, 200)

        logout_response = self.client.post(
            "/api/auth/logout/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(logout_response.status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_protected_api_is_inaccessible_after_logout(self):
        login_response = self.login_user()
        self.assertEqual(login_response.status_code, 200)
        logout_response = self.client.post(
            "/api/auth/logout/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(logout_response.status_code, 200)

        response = self.client.get("/api/users/me/")
        self.assertEqual(response.status_code, 403)

    def test_overlap_reservation_is_rejected(self):
        Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(12, 0),
            status=Reservation.STATUS_CONFIRMED,
        )

        with self.assertRaisesMessage(ValueError, "This time overlaps an existing reservation for the same resource."):
            create_or_update_reservation(
                user=self.user,
                resource_id=self.resource.id,
                reservation_date=date(2025, 1, 15),
                start_time=time(11, 30),
                end_time=time(13, 0),
                notes="Attempted overlap",
            )

    def test_user_can_create_valid_reservation(self):
        reservation = create_or_update_reservation(
            user=self.user,
            resource_id=self.resource.id,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(16, 0),
            notes="Team sync",
        )
        self.assertEqual(reservation.user, self.user)
        self.assertEqual(reservation.resource, self.resource)
        self.assertEqual(reservation.status, Reservation.STATUS_CONFIRMED)

    def test_user_cannot_view_another_users_reservation_detail(self):
        other_user = User.objects.create_user(
            username="user2",
            email="user2@example.com",
            password="secretpass123",
            role=User.ROLE_USER,
        )
        reservation = Reservation.objects.create(
            user=other_user,
            resource=self.resource,
            reservation_date=date(2025, 1, 16),
            start_time=time(10, 0),
            end_time=time(11, 0),
            status=Reservation.STATUS_CONFIRMED,
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get(f"/api/reservations/{reservation.id}/")

        self.assertEqual(response.status_code, 403)

    def test_user_cannot_update_or_cancel_another_users_reservation(self):
        other_user = User.objects.create_user(
            username="user3",
            email="user3@example.com",
            password="safe-test-password",
            role=User.ROLE_USER,
        )
        reservation = Reservation.objects.create(
            user=other_user,
            resource=self.resource,
            reservation_date=date(2025, 1, 16),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        self.client.force_authenticate(user=self.user)
        update_response = self.client.put(
            f"/api/reservations/{reservation.id}/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-16",
                "start_time": "12:00",
                "end_time": "13:00",
            },
            format="json",
        )
        cancel_response = self.client.delete(
            f"/api/reservations/{reservation.id}/"
        )

        self.assertEqual(update_response.status_code, 403)
        self.assertEqual(cancel_response.status_code, 403)
        reservation.refresh_from_db()
        self.assertEqual(reservation.user, other_user)
        self.assertEqual(reservation.status, Reservation.STATUS_CONFIRMED)

    def test_user_can_create_update_and_cancel_own_reservation(self):
        self.client.force_authenticate(user=self.user)
        payload = {
            "resource": self.resource.id,
            "reservation_date": "2025-01-15",
            "start_time": "10:00",
            "end_time": "11:00",
            "notes": "Initial booking",
        }
        create_response = self.client.post(
            "/api/reservations/",
            payload,
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        reservation_id = create_response.data["id"]

        overlapping_response = self.client.post(
            "/api/reservations/",
            {**payload, "start_time": "10:30", "end_time": "11:30"},
            format="json",
        )
        self.assertEqual(overlapping_response.status_code, 400)

        update_response = self.client.put(
            f"/api/reservations/{reservation_id}/",
            {**payload, "start_time": "12:00", "end_time": "13:00"},
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["start_time"], "12:00:00")

        cancel_response = self.client.delete(
            f"/api/reservations/{reservation_id}/"
        )
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(
            Reservation.objects.get(pk=reservation_id).status,
            Reservation.STATUS_CANCELLED,
        )

    def test_regular_user_cannot_manage_admin_resources_or_constraints(self):
        self.client.force_authenticate(user=self.user)
        resource_response = self.client.post(
            "/api/resources/",
            {"name": "New Room", "resource_type": "room"},
            format="json",
        )
        constraint_response = self.client.post(
            f"/api/resources/{self.resource.id}/constraints/",
            {
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "12:00",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(resource_response.status_code, 403)
        self.assertEqual(constraint_response.status_code, 403)

    def test_admin_can_create_resource_and_constraint_and_constraint_limits_booking(self):
        self.client.force_authenticate(user=self.admin)
        resource_response = self.client.post(
            "/api/resources/",
            {
                "name": "Configured Room",
                "resource_type": "room",
                "default_start_time": "09:00",
                "default_end_time": "18:00",
            },
            format="json",
        )
        self.assertEqual(resource_response.status_code, 201)
        resource_id = resource_response.data["id"]
        constraint_response = self.client.post(
            f"/api/resources/{resource_id}/constraints/",
            {
                "day_of_week": 0,
                "start_time": "10:00",
                "end_time": "12:00",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(constraint_response.status_code, 201)

        with self.assertRaisesMessage(
            ValueError,
            "The requested time falls outside the resource's configured availability.",
        ):
            create_or_update_reservation(
                user=self.user,
                resource_id=resource_id,
                reservation_date=date(2025, 1, 13),
                start_time=time(9, 0),
                end_time=time(10, 0),
            )
        with self.assertRaisesMessage(
            ValueError,
            "The requested time falls outside the resource's configured availability.",
        ):
            create_or_update_reservation(
                user=self.user,
                resource_id=resource_id,
                reservation_date=date(2025, 1, 14),
                start_time=time(10, 0),
                end_time=time(11, 0),
            )
        reservation = create_or_update_reservation(
            user=self.user,
            resource_id=resource_id,
            reservation_date=date(2025, 1, 13),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        self.assertEqual(reservation.resource_id, resource_id)

    def test_admin_constraint_rejects_invalid_weekday_and_time_range(self):
        self.client.force_authenticate(user=self.admin)
        invalid_weekday = self.client.post(
            f"/api/resources/{self.resource.id}/constraints/",
            {
                "day_of_week": 7,
                "start_time": "09:00",
                "end_time": "10:00",
            },
            format="json",
        )
        invalid_range = self.client.post(
            f"/api/resources/{self.resource.id}/constraints/",
            {
                "day_of_week": 0,
                "start_time": "12:00",
                "end_time": "11:00",
            },
            format="json",
        )
        self.assertEqual(invalid_weekday.status_code, 400)
        self.assertEqual(invalid_range.status_code, 400)

    def test_admin_can_edit_and_delete_constraints_and_delete_unused_resource(self):
        self.client.force_authenticate(user=self.admin)
        constraint_response = self.client.post(
            f"/api/resources/{self.resource.id}/constraints/",
            {
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "12:00",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(constraint_response.status_code, 201)
        constraint_id = constraint_response.data["id"]

        update_response = self.client.put(
            f"/api/resource-constraints/{constraint_id}/",
            {
                "day_of_week": 0,
                "start_time": "10:00",
                "end_time": "13:00",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["start_time"], "10:00:00")

        delete_constraint_response = self.client.delete(
            f"/api/resource-constraints/{constraint_id}/"
        )
        self.assertEqual(delete_constraint_response.status_code, 204)
        delete_resource_response = self.client.delete(
            f"/api/resources/{self.resource.id}/"
        )
        self.assertEqual(delete_resource_response.status_code, 204)
        self.assertFalse(Resource.objects.filter(pk=self.resource.id).exists())

    def test_admin_resource_delete_preserves_reservation_history(self):
        reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/resources/{self.resource.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Resource.objects.filter(pk=self.resource.pk).exists())
        self.assertTrue(Reservation.objects.filter(pk=reservation.pk).exists())

    def test_inactive_resource_cannot_be_reserved(self):
        self.resource.is_active = False
        self.resource.save(update_fields=["is_active"])

        with self.assertRaisesMessage(ValueError, "This resource is not active and cannot be reserved."):
            create_or_update_reservation(
                user=self.user,
                resource_id=self.resource.id,
                reservation_date=date(2025, 1, 15),
                start_time=time(10, 0),
                end_time=time(11, 0),
            )

    def test_admin_can_edit_and_deactivate_resource(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(
            f"/api/resources/{self.resource.id}/",
            {"name": "Updated Board Room", "is_active": False},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "Updated Board Room")
        self.assertFalse(response.data["is_active"])
        with self.assertRaisesMessage(
            ValueError,
            "This resource is not active and cannot be reserved.",
        ):
            create_or_update_reservation(
                user=self.user,
                resource_id=self.resource.id,
                reservation_date=date(2025, 1, 15),
                start_time=time(10, 0),
                end_time=time(11, 0),
            )

    def test_resource_availability_includes_other_users_confirmed_and_pending_reservations(self):
        confirmed = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0),
            status=Reservation.STATUS_CONFIRMED,
        )
        pending = Reservation.objects.create(
            user=self.admin,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(12, 0),
            end_time=time(13, 0),
            status=Reservation.STATUS_PENDING,
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(
            f"/api/resources/{self.resource.id}/availability/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["status"] for item in response.data["bookings"]},
            {confirmed.status, pending.status},
        )

    def test_resource_availability_filters_inclusive_date_range(self):
        first = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 14),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        Reservation.objects.create(
            user=self.admin,
            resource=self.resource,
            reservation_date=date(2025, 1, 16),
            start_time=time(12, 0),
            end_time=time(13, 0),
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(
            f"/api/resources/{self.resource.id}/availability/",
            {"start_date": "2025-01-14", "end_date": "2025-01-15"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["date"] for item in response.data["bookings"]],
            [first.reservation_date.isoformat()],
        )

    def test_resource_availability_rejects_incomplete_or_reversed_date_range(self):
        self.client.force_authenticate(user=self.user)

        incomplete = self.client.get(
            f"/api/resources/{self.resource.id}/availability/",
            {"start_date": "2025-01-14"},
        )
        reversed_range = self.client.get(
            f"/api/resources/{self.resource.id}/availability/",
            {"start_date": "2025-01-16", "end_date": "2025-01-14"},
        )
        invalid_date = self.client.get(
            f"/api/resources/{self.resource.id}/availability/",
            {"start_date": "not-a-date", "end_date": "2025-01-16"},
        )

        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(reversed_range.status_code, 400)
        self.assertEqual(invalid_date.status_code, 400)

    def test_admin_reservation_api_is_admin_only_and_cancels_without_deleting_history(self):
        reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get("/api/admin/reservations/").status_code, 403)
        self.assertEqual(
            self.client.delete(f"/api/admin/reservations/{reservation.id}/").status_code,
            403,
        )

        self.client.force_authenticate(user=self.admin)
        cancel_response = self.client.delete(
            f"/api/admin/reservations/{reservation.id}/"
        )
        self.assertEqual(cancel_response.status_code, 200)
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, Reservation.STATUS_CANCELLED)

    def test_admin_account_creation_hashes_password_and_is_admin_only(self):
        admin_payload = {
            "email": "new-admin@example.com",
            "first_name": "New",
            "last_name": "Admin",
            "password": "Strong-Admin-Pass-47!",
        }
        self.client.force_authenticate(user=self.user)
        self.assertEqual(
            self.client.post("/api/admins/", admin_payload, format="json").status_code,
            403,
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/admins/", admin_payload, format="json")
        self.assertEqual(response.status_code, 201)
        created_admin = User.objects.get(email=admin_payload["email"])
        self.assertEqual(created_admin.role, User.ROLE_ADMIN)
        self.assertTrue(created_admin.check_password(admin_payload["password"]))

    def test_admin_account_creation_rejects_weak_password(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/admins/",
            {
                "email": "weak-password-admin@example.com",
                "password": "password",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email="weak-password-admin@example.com").exists())

    def test_inactive_admin_cannot_use_admin_endpoints_or_delete_account(self):
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get("/api/admins/").status_code, 403)
        self.assertEqual(self.client.get("/api/resources/").status_code, 403)

    def test_last_active_admin_cannot_be_deleted(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/admins/{self.admin.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "The last active administrator cannot be deleted.")
        self.assertTrue(
            User.objects.filter(pk=self.admin.pk, role=User.ROLE_ADMIN).exists()
        )

    def test_admin_account_delete_allowed_when_another_active_admin_exists(self):
        another_admin = User.objects.create_user(
            username="admin2",
            email="admin2@example.com",
            password="secretpass123",
            role=User.ROLE_ADMIN,
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/admins/{another_admin.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=another_admin.pk).exists())

    def test_admin_account_with_reservation_history_cannot_be_deleted(self):
        another_admin = User.objects.create_user(
            username="admin2",
            email="admin2@example.com",
            password="secretpass123",
            role=User.ROLE_ADMIN,
        )
        Reservation.objects.create(
            user=another_admin,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/admins/{another_admin.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=another_admin.pk).exists())


class ReservationConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.users = [
            User.objects.create_user(
                username=f"concurrent-user-{index}",
                email=f"concurrent-user-{index}@example.com",
                password="safe-test-password",
            )
            for index in range(2)
        ]
        self.resource = Resource.objects.create(
            name="Concurrent Booking Room",
            default_start_time=time(9, 0),
            default_end_time=time(18, 0),
        )

    @skipUnless(
        connection.vendor == "postgresql",
        "Concurrent row-lock behavior requires PostgreSQL.",
    )
    def test_concurrent_overlapping_bookings_allow_only_one_reservation(self):
        barrier = Barrier(2)

        def attempt_booking(email):
            close_old_connections()
            try:
                user = User.objects.get(email=email)
                barrier.wait(timeout=10)
                try:
                    create_or_update_reservation(
                        user=user,
                        resource_id=self.resource.pk,
                        reservation_date=date(2025, 1, 15),
                        start_time=time(10, 0),
                        end_time=time(11, 0),
                    )
                    return "created"
                except ValueError:
                    return "rejected"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(attempt_booking, [user.email for user in self.users])
            )

        self.assertCountEqual(results, ["created", "rejected"])
        self.assertEqual(
            Reservation.objects.filter(
                resource=self.resource,
                reservation_date=date(2025, 1, 15),
                status__in=[Reservation.STATUS_PENDING, Reservation.STATUS_CONFIRMED],
            ).count(),
            1,
        )
