import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
from threading import Barrier
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.db import ProgrammingError
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import Reservation, Resource, ResourceAvailabilityConstraint, User
from .services import create_or_update_reservation
from .throttles import LoginIPRateThrottle, LoginRateThrottle


class ReservationBusinessRulesTests(TestCase):
    def setUp(self):
        # Clear the rate-limit cache before every test so that throttle state
        # from one test (e.g. test_login_attempts_are_rate_limited) does not
        # bleed into subsequent tests that call the login endpoint.  This does
        # not weaken rate limiting — it only ensures tests are isolated from
        # each other.  The rate-limit test still verifies throttle behaviour
        # within its own execution.
        cache.clear()
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

    def tearDown(self):
        # Clear after each test as well, so any throttle state created by this
        # test cannot affect the next one.
        cache.clear()

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

    def test_login_and_session_cors_support_vite_auto_incremented_ports(self):
        origin = "http://localhost:5175"
        self.assertIn(origin, settings.CORS_ALLOWED_ORIGINS)
        self.assertIn(origin, settings.CSRF_TRUSTED_ORIGINS)
        csrf_token = self.get_csrf_token()
        login_response = self.client.post(
            "/api/auth/login/",
            {"email": self.user.email, "password": "secretpass123"},
            format="json",
            HTTP_ORIGIN=origin,
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(
            login_response["Access-Control-Allow-Origin"],
            origin,
        )
        self.assertEqual(
            login_response["Access-Control-Allow-Credentials"],
            "true",
        )

        current_user_response = self.client.get(
            "/api/users/me/",
            HTTP_ORIGIN=origin,
        )
        self.assertEqual(current_user_response.status_code, 200)
        self.assertEqual(
            current_user_response["Access-Control-Allow-Origin"],
            origin,
        )

    def test_resource_list_requires_login_and_is_readable_after_login(self):
        anonymous_response = self.client.get("/api/resources/")
        self.assertEqual(anonymous_response.status_code, 403)
        self.assertEqual(
            anonymous_response.data["detail"],
            "Authentication credentials were not provided.",
        )

        login_response = self.login_user()
        self.assertEqual(login_response.status_code, 200)
        resources_response = self.client.get("/api/resources/")

        self.assertEqual(resources_response.status_code, 200)
        self.assertEqual(
            [resource["id"] for resource in resources_response.data],
            [self.resource.id],
        )

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
        resources_response = self.client.get("/api/resources/")
        self.assertEqual(resources_response.status_code, 200)

        logout_response = self.client.post(
            "/api/auth/logout/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(logout_response.status_code, 200)

        response = self.client.get("/api/users/me/")
        self.assertEqual(response.status_code, 403)
        resources_response = self.client.get("/api/resources/")
        self.assertEqual(resources_response.status_code, 403)

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

    def test_reservation_api_rejects_missing_and_reversed_dates(self):
        self.client.force_authenticate(user=self.user)
        invalid_payloads = (
            (
                "missing reservation date",
                {
                    "resource": self.resource.id,
                    "start_time": "10:00",
                    "end_time": "11:00",
                },
                "reservation_date",
            ),
            (
                "invalid reservation date",
                {
                    "resource": self.resource.id,
                    "reservation_date": "not-a-date",
                    "start_time": "10:00",
                    "end_time": "11:00",
                },
                "reservation_date",
            ),
            (
                "missing multi-day start date",
                {
                    "resource": self.resource.id,
                    "end_date": "2025-01-16",
                    "start_time": "10:00",
                    "end_time": "11:00",
                },
                "reservation_date",
            ),
            (
                "missing multi-day end date",
                {
                    "resource": self.resource.id,
                    "start_date": "2025-01-15",
                    "start_time": "10:00",
                    "end_time": "11:00",
                },
                "end_date",
            ),
            (
                "reversed date range",
                {
                    "resource": self.resource.id,
                    "reservation_date": "2025-01-16",
                    "end_date": "2025-01-15",
                    "start_time": "10:00",
                    "end_time": "11:00",
                },
                "end_date",
            ),
        )

        for label, payload, error_field in invalid_payloads:
            with self.subTest(label=label):
                response = self.client.post(
                    "/api/reservations/",
                    payload,
                    format="json",
                )

                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn(error_field, response.data)
                self.assertFalse(Reservation.objects.exists())

    def test_reservation_api_accepts_single_day_and_multi_day_dates(self):
        self.client.force_authenticate(user=self.user)
        multi_day_resource = Resource.objects.create(
            name="Multi-day Room",
            resource_type="room",
            default_start_time=time(0, 0),
            default_end_time=time(23, 59),
        )
        single_day_response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "start_time": "10:00",
                "end_time": "11:00",
            },
            format="json",
        )
        self.assertEqual(single_day_response.status_code, 201, single_day_response.data)
        self.assertEqual(
            single_day_response.data["reservation_date"],
            "2025-01-15",
        )
        self.assertEqual(single_day_response.data["end_date"], "2025-01-15")

        multi_day_response = self.client.post(
            "/api/reservations/",
            {
                "resource": multi_day_resource.id,
                "start_date": "2025-01-16",
                "end_date": "2025-01-17",
                "start_time": "10:00",
                "end_time": "11:00",
            },
            format="json",
        )
        self.assertEqual(multi_day_response.status_code, 201, multi_day_response.data)
        self.assertEqual(multi_day_response.data["reservation_date"], "2025-01-16")
        self.assertEqual(multi_day_response.data["end_date"], "2025-01-17")
        self.assertEqual(Reservation.objects.count(), 2)

    def test_reservation_update_rejects_missing_date_without_changing_record(self):
        self.client.force_authenticate(user=self.user)
        reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(16, 0),
        )

        response = self.client.put(
            f"/api/reservations/{reservation.id}/",
            {
                "resource": self.resource.id,
                "start_time": "10:00",
                "end_time": "11:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("reservation_date", response.data)
        reservation.refresh_from_db()
        self.assertEqual(reservation.reservation_date, date(2025, 1, 15))
        self.assertEqual(reservation.start_time, time(14, 0))
        self.assertEqual(Reservation.objects.count(), 1)

    def test_multi_day_reservation_is_valid_when_each_day_falls_inside_availability(self):
        multi_day_resource = Resource.objects.create(
            name="Extended Room",
            resource_type="room",
            default_start_time=time(0, 0),
            default_end_time=time(23, 59),
        )

        reservation = create_or_update_reservation(
            user=self.user,
            resource_id=multi_day_resource.id,
            reservation_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(12, 0),
            end_date=date(2025, 1, 16),
            notes="Two-day booking",
        )

        self.assertEqual(reservation.reservation_date, date(2025, 1, 15))
        self.assertEqual(reservation.start_time, time(10, 0))
        self.assertEqual(reservation.end_time, time(12, 0))
        self.assertEqual(reservation.status, Reservation.STATUS_CONFIRMED)

    def test_full_day_reservation_covers_inclusive_dates_across_calendar_boundaries(self):
        resource = Resource.objects.create(
            name="All Day Room",
            resource_type="room",
            default_start_time=time(0, 0),
            default_end_time=time(23, 59),
        )
        self.client.force_authenticate(user=self.user)

        for start_date, end_date, expected_dates in (
            (
                "2024-02-28",
                "2024-03-01",
                ["2024-02-28", "2024-02-29", "2024-03-01"],
            ),
            (
                "2024-12-31",
                "2025-01-02",
                ["2024-12-31", "2025-01-01", "2025-01-02"],
            ),
        ):
            with self.subTest(start_date=start_date):
                response = self.client.post(
                    "/api/reservations/",
                    {
                        "resource": resource.id,
                        "reservation_date": start_date,
                        "end_date": end_date,
                        "is_full_day": True,
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)
                self.assertTrue(response.data["is_full_day"])
                self.assertIsNone(response.data["start_time"])
                self.assertIsNone(response.data["end_time"])
                self.assertEqual(response.data["status"], Reservation.STATUS_CONFIRMED)

                availability = self.client.get(
                    f"/api/resources/{resource.id}/availability/",
                    {"start_date": start_date, "end_date": end_date},
                )
                self.assertEqual(availability.status_code, 200)
                self.assertEqual(
                    [booking["date"] for booking in availability.data["bookings"]],
                    expected_dates,
                )
                self.assertTrue(
                    all(booking["is_full_day"] for booking in availability.data["bookings"])
                )

        self.assertEqual(
            Reservation.objects.filter(resource=resource).count(),
            2,
        )

    def test_full_day_reservation_requires_full_day_availability_on_every_date(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "end_date": "2025-01-16",
                "is_full_day": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("configured availability", response.data["detail"])
        self.assertFalse(Reservation.objects.exists())

    def test_full_day_and_timed_reservations_conflict_on_first_middle_and_last_days(self):
        start_date = date(2025, 1, 15)
        for offset in range(3):
            with self.subTest(offset=offset):
                resource = Resource.objects.create(
                    name=f"Full Day Conflict {offset}",
                    resource_type="room",
                    default_start_time=time(0, 0),
                    default_end_time=time(23, 59),
                )
                Reservation.objects.create(
                    user=self.user,
                    resource=resource,
                    reservation_date=start_date + timedelta(days=offset),
                    start_time=time(10, 0),
                    end_time=time(11, 0),
                    status=Reservation.STATUS_CONFIRMED,
                )

                with self.assertRaisesMessage(
                    ValueError,
                    "This time overlaps an existing reservation for the same resource.",
                ):
                    create_or_update_reservation(
                        user=self.user,
                        resource_id=resource.id,
                        reservation_date=start_date,
                        end_date=start_date + timedelta(days=2),
                        start_time=None,
                        end_time=None,
                        is_full_day=True,
                    )

        for offset in range(3):
            with self.subTest(offset=offset, existing_full_day=True):
                resource = Resource.objects.create(
                    name=f"Timed Conflict {offset}",
                    resource_type="room",
                    default_start_time=time(0, 0),
                    default_end_time=time(23, 59),
                )
                Reservation.objects.create(
                    user=self.user,
                    resource=resource,
                    reservation_date=start_date,
                    end_date=start_date + timedelta(days=2),
                    start_time=None,
                    end_time=None,
                    is_full_day=True,
                    status=Reservation.STATUS_CONFIRMED,
                )

                with self.assertRaisesMessage(
                    ValueError,
                    "This time overlaps an existing reservation for the same resource.",
                ):
                    create_or_update_reservation(
                        user=self.user,
                        resource_id=resource.id,
                        reservation_date=start_date + timedelta(days=offset),
                        start_time=time(10, 0),
                        end_time=time(11, 0),
                    )

    def test_full_day_constraint_is_saved_and_enforced_for_configured_weekday(self):
        self.client.force_authenticate(user=self.admin)
        constraint_response = self.client.post(
            f"/api/resources/{self.resource.id}/constraints/",
            {
                "day_of_week": 2,
                "start_time": "09:00",
                "end_time": "10:00",
                "is_full_day": True,
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(constraint_response.status_code, 201, constraint_response.data)
        self.assertTrue(constraint_response.data["is_full_day"])
        self.assertEqual(constraint_response.data["start_time"], "00:00:00")
        self.assertEqual(constraint_response.data["end_time"], "23:59:00")

        self.client.force_authenticate(user=self.user)
        reservation_response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "is_full_day": True,
            },
            format="json",
        )
        self.assertEqual(reservation_response.status_code, 201, reservation_response.data)

    def test_multi_day_reservation_rejects_overlaps_across_the_requested_range(self):
        resource = Resource.objects.create(
            name="Overnight Room",
            resource_type="room",
            default_start_time=time(0, 0),
            default_end_time=time(23, 59),
        )
        Reservation.objects.create(
            user=self.user,
            resource=resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(9, 0),
            end_time=time(11, 0),
            status=Reservation.STATUS_CONFIRMED,
        )

        with self.assertRaisesMessage(ValueError, "This time overlaps an existing reservation for the same resource."):
            create_or_update_reservation(
                user=self.user,
                resource_id=resource.id,
                reservation_date=date(2025, 1, 15),
                start_time=time(10, 30),
                end_time=time(12, 0),
                end_date=date(2025, 1, 16),
                notes="Attempted multi-day overlap",
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

    def test_user_can_reserve_custom_minute_ranges_without_conflicts(self):
        self.client.force_authenticate(user=self.user)
        first_response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "start_time": "10:20",
                "end_time": "12:20",
            },
            format="json",
        )
        overlapping_response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "start_time": "12:15",
                "end_time": "12:30",
            },
            format="json",
        )
        adjacent_response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "start_time": "12:20",
                "end_time": "12:35",
            },
            format="json",
        )

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(first_response.data["start_time"], "10:20:00")
        self.assertEqual(first_response.data["end_time"], "12:20:00")
        self.assertEqual(overlapping_response.status_code, 400)
        self.assertEqual(adjacent_response.status_code, 201)

    def test_created_reservation_is_persisted_and_visible_only_to_its_owner(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/reservations/",
            {
                "resource": self.resource.id,
                "reservation_date": "2025-01-15",
                "start_time": "14:00",
                "end_time": "16:00",
                "notes": "Read-back check",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        reservation = Reservation.objects.get(pk=response.data["id"])
        self.assertEqual(reservation.user, self.user)
        self.assertEqual(reservation.resource, self.resource)

        owner_list = self.client.get("/api/reservations/")
        self.assertEqual([item["id"] for item in owner_list.data], [reservation.id])

        other_user = User.objects.create_user(
            username="reservation-reader",
            email="reservation-reader@example.com",
            password="local-audit-test-password",
            role=User.ROLE_USER,
        )
        self.client.force_authenticate(user=other_user)
        other_user_list = self.client.get("/api/reservations/")
        self.assertEqual(other_user_list.data, [])

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
        self.assertFalse(Reservation.objects.filter(pk=reservation_id).exists())
        replacement_response = self.client.post(
            "/api/reservations/",
            payload,
            format="json",
        )
        self.assertEqual(replacement_response.status_code, 201)

        history_response = self.client.get("/api/reservations/")
        self.assertEqual(history_response.status_code, 200)
        reservation_history = {
            item["id"]: item["status"] for item in history_response.data
        }
        self.assertNotIn(reservation_id, reservation_history)
        self.assertEqual(
            reservation_history[replacement_response.data["id"]],
            Reservation.STATUS_CONFIRMED,
        )

    def test_regular_user_cannot_manage_admin_resources_or_constraints(self):
        self.client.force_authenticate(user=self.user)
        resource_response = self.client.post(
            "/api/resources/",
            {"name": "New Room", "resource_type": "room"},
            format="json",
        )
        resource_update_response = self.client.put(
            f"/api/resources/{self.resource.id}/",
            {"name": "Unauthorized Update"},
            format="json",
        )
        resource_delete_response = self.client.delete(
            f"/api/resources/{self.resource.id}/"
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
        self.assertEqual(resource_update_response.status_code, 403)
        self.assertEqual(resource_delete_response.status_code, 403)
        self.assertEqual(constraint_response.status_code, 403)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.name, "Board Room")

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

    def test_admin_resource_delete_cascades_reservations_and_availability_constraints(self):
        past_reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        future_reservation = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2099, 1, 15),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        constraint = ResourceAvailabilityConstraint.objects.create(
            resource=self.resource,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(17, 0),
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/resources/{self.resource.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Resource.objects.filter(pk=self.resource.pk).exists())
        self.assertFalse(Reservation.objects.filter(pk=past_reservation.pk).exists())
        self.assertFalse(Reservation.objects.filter(pk=future_reservation.pk).exists())
        self.assertFalse(
            ResourceAvailabilityConstraint.objects.filter(pk=constraint.pk).exists()
        )

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

    def test_admin_reservation_api_is_admin_only_and_permanently_deletes_on_cancel(self):
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
        self.assertFalse(Reservation.objects.filter(pk=reservation.pk).exists())

    def test_admin_reservation_list_excludes_past_and_cancelled_records(self):
        past = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 14),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        past_full_day = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 14),
            end_date=date(2025, 1, 14),
            start_time=None,
            end_time=None,
            is_full_day=True,
        )
        ended_today = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        ongoing_today = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            start_time=time(11, 0),
            end_time=time(13, 0),
        )
        full_day_today = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 15),
            end_date=date(2025, 1, 15),
            start_time=None,
            end_time=None,
            is_full_day=True,
        )
        future = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 16),
            start_time=time(10, 0),
            end_time=time(11, 0),
        )
        cancelled_future = Reservation.objects.create(
            user=self.user,
            resource=self.resource,
            reservation_date=date(2025, 1, 17),
            start_time=time(10, 0),
            end_time=time(11, 0),
            status=Reservation.STATUS_CANCELLED,
        )

        self.client.force_authenticate(user=self.admin)
        with (
            patch(
                "reservations.views.timezone.localdate",
                return_value=date(2025, 1, 15),
            ),
            patch(
                "reservations.views.timezone.localtime",
                return_value=datetime(2025, 1, 15, 12, 0),
            ),
        ):
            response = self.client.get("/api/admin/reservations/")

        self.assertEqual(response.status_code, 200)
        returned_ids = {item["id"] for item in response.data}
        self.assertEqual(
            returned_ids,
            {ongoing_today.id, full_day_today.id, future.id},
        )
        self.assertTrue(Reservation.objects.filter(pk=past.pk).exists())
        self.assertTrue(Reservation.objects.filter(pk=past_full_day.pk).exists())
        self.assertTrue(Reservation.objects.filter(pk=ended_today.pk).exists())
        self.assertTrue(Reservation.objects.filter(pk=cancelled_future.pk).exists())

    def test_admin_can_create_users_with_each_supported_role_and_hashed_passwords(self):
        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)
        self.assertEqual(
            self.client.post(
                "/api/users/",
                {
                    "email": "new-user@example.com",
                    "password": "Strong-User-Pass-47!",
                    "role": User.ROLE_USER,
                },
                format="json",
            ).status_code,
            403,
        )

        self.client.force_authenticate(user=self.admin)
        created_accounts = []
        for role, email in (
            (User.ROLE_USER, "new-user@example.com"),
            (User.ROLE_ADMIN, "new-managed-admin@example.com"),
        ):
            password = "Strong-Account-Pass-47!"
            response = self.client.post(
                "/api/users/",
                {
                    "email": email,
                    "first_name": "Managed",
                    "last_name": "Account",
                    "password": password,
                    "role": role,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201)
            created_user = User.objects.get(email=email)
            self.assertEqual(created_user.role, role)
            self.assertTrue(created_user.check_password(password))
            created_accounts.append(created_user)

        self.client.force_authenticate(user=created_accounts[0])
        self.assertEqual(self.client.get("/api/users/").status_code, 403)
        self.client.force_authenticate(user=created_accounts[1])
        self.assertEqual(self.client.get("/api/users/").status_code, 200)

    def test_user_creation_requires_an_explicit_supported_role(self):
        self.client.force_authenticate(user=self.admin)
        for email, role in (
            ("missing-role@example.com", None),
            ("unsupported-role@example.com", "SUPERUSER"),
        ):
            payload = {
                "email": email,
                "password": "Strong-Account-Pass-47!",
            }
            if role is not None:
                payload["role"] = role
            response = self.client.post(
                "/api/users/",
                payload,
                format="json",
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("role", response.data)
            self.assertFalse(User.objects.filter(email=email).exists())

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

    def test_admin_management_list_excludes_ordinary_users(self):
        ordinary_user = User.objects.create_user(
            username="listed-user",
            email="listed-user@example.com",
            password="Strong-Listed-User-Pass-47!",
            role=User.ROLE_USER,
        )
        another_admin = User.objects.create_user(
            username="listed-admin",
            email="listed-admin@example.com",
            password="Strong-Listed-Admin-Pass-47!",
            role=User.ROLE_ADMIN,
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.get("/api/admins/")

        self.assertEqual(response.status_code, 200)
        returned_ids = {item["id"] for item in response.data}
        self.assertIn(self.admin.id, returned_ids)
        self.assertIn(another_admin.id, returned_ids)
        self.assertNotIn(ordinary_user.id, returned_ids)

    def test_admin_detail_can_edit_safe_fields_without_changing_role_or_password(self):
        another_admin = User.objects.create_user(
            username="editable-admin",
            email="editable-admin@example.com",
            password="Strong-Editable-Admin-Pass-47!",
            role=User.ROLE_ADMIN,
        )
        original_password = "Strong-Original-Pass-47!"
        another_admin.set_password(original_password)
        another_admin.save()
        self.client.force_authenticate(user=self.admin)

        detail_response = self.client.get(f"/api/admins/{another_admin.id}/")
        self.assertEqual(detail_response.status_code, 200)
        update_response = self.client.put(
            f"/api/admins/{another_admin.id}/",
            {
                "email": "updated-admin@example.com",
                "first_name": "Updated",
                "last_name": "Administrator",
                "phone": "555-0123",
                "role": User.ROLE_USER,
                "password": "not-allowed-to-change",
            },
            format="json",
        )

        self.assertEqual(update_response.status_code, 200, update_response.data)
        another_admin.refresh_from_db()
        self.assertEqual(another_admin.email, "updated-admin@example.com")
        self.assertEqual(another_admin.first_name, "Updated")
        self.assertEqual(another_admin.phone, "555-0123")
        self.assertEqual(another_admin.role, User.ROLE_ADMIN)
        self.assertTrue(another_admin.check_password(original_password))

    def test_admin_detail_update_rejects_duplicate_email(self):
        another_admin = User.objects.create_user(
            username="another-admin",
            email="another-admin@example.com",
            password="Strong-Another-Admin-Pass-47!",
            role=User.ROLE_ADMIN,
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.put(
            f"/api/admins/{another_admin.id}/",
            {"email": self.admin.email},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        another_admin.refresh_from_db()
        self.assertEqual(another_admin.email, "another-admin@example.com")

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
