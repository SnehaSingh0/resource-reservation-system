from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

from django.conf import settings
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import resolve
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient, APIRequestFactory

from .authentication import TimedSessionAuthentication
from .middleware import RequestTimingMiddleware
from .models import User
from .views import LoginView, ResourceListCreateView


class RequestTimingMiddlewareTests(SimpleTestCase):
    @override_settings(REQUEST_TIMING_ENABLED=True)
    def test_logs_safe_metadata_and_preserves_response(self):
        request = RequestFactory().post(
            "/api/resources/123/?token=query-secret",
            data="request-body-secret",
            content_type="text/plain",
            HTTP_AUTHORIZATION="Bearer authorization-secret",
            HTTP_COOKIE="sessionid=cookie-secret",
        )
        request.resolver_match = resolve("/api/resources/123/")
        response = HttpResponse("response-body-secret", status=202)
        middleware = RequestTimingMiddleware(lambda _request: response)

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            actual_response = middleware(request)

        self.assertIs(actual_response, response)
        self.assertEqual(actual_response.status_code, 202)
        log_line = captured.output[0]
        self.assertIn("method=POST", log_line)
        self.assertIn("path=/api/resources/<int:pk>/", log_line)
        self.assertIn("status=202", log_line)
        self.assertRegex(log_line, r"duration_ms=\d+\.\d{2}")
        for sensitive_value in (
            "query-secret",
            "request-body-secret",
            "authorization-secret",
            "cookie-secret",
            "response-body-secret",
            "123",
        ):
            self.assertNotIn(sensitive_value, log_line)

    @override_settings(REQUEST_TIMING_ENABLED=False)
    @patch("reservations.middleware.connection.execute_wrapper")
    def test_disabled_timing_does_not_install_sql_wrapper(self, execute_wrapper):
        request = RequestFactory().get("/api/users/me/")
        response = HttpResponse("unchanged")
        middleware = RequestTimingMiddleware(lambda _request: response)

        actual_response = middleware(request)

        self.assertIs(actual_response, response)
        execute_wrapper.assert_not_called()


class RequestTimingSqlMiddlewareTests(TestCase):
    @override_settings(REQUEST_TIMING_ENABLED=True)
    def test_logs_each_resource_sql_duration_without_values(self):
        from django.db import connection

        request = RequestFactory().get("/api/resources/")
        request.resolver_match = resolve("/api/resources/")

        def get_response(_request):
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT %s, 'inline-secret', 123",
                    ["sql-parameter-secret"],
                )
                cursor.execute("SELECT 2")
            return HttpResponse("response")

        middleware = RequestTimingMiddleware(get_response)
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            middleware(request)

        query_logs = [
            log_line for log_line in captured.output if "sql_query=" in log_line
        ]
        self.assertEqual(len(query_logs), 2)
        self.assertRegex(query_logs[0], r"sql_query=1 sql_duration_ms=\d+\.\d{2}")
        self.assertIn("sql=SELECT %s, ?, ?", query_logs[0])
        self.assertRegex(query_logs[1], r"sql_query=2 sql_duration_ms=\d+\.\d{2}")
        self.assertIn("sql=SELECT ?", query_logs[1])
        aggregate_log = captured.output[-1]
        self.assertIn("sql_query_count=2", aggregate_log)
        self.assertRegex(aggregate_log, r"sql_duration_ms=\d+\.\d{2}")
        for sensitive_value in ("sql-parameter-secret", "inline-secret", "123"):
            self.assertNotIn(sensitive_value, "\n".join(captured.output))

    @override_settings(REQUEST_TIMING_ENABLED=True)
    def test_logs_aggregate_sql_timing_without_sql_or_parameters(self):
        from django.db import connection

        request = RequestFactory().get("/api/auth/csrf/?secret=query-secret")
        request.resolver_match = resolve("/api/auth/csrf/")

        def get_response(_request):
            with connection.cursor() as cursor:
                cursor.execute("SELECT %s", ["sql-parameter-secret"])
            return HttpResponse("response")

        middleware = RequestTimingMiddleware(get_response)
        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            middleware(request)

        log_line = captured.output[0]
        self.assertIn("sql_query_count=1", log_line)
        self.assertRegex(log_line, r"sql_duration_ms=\d+\.\d{2}")
        self.assertIn("duration_ms=", log_line)
        self.assertNotIn("sql_query=", log_line)
        for sensitive_value in ("SELECT", "sql-parameter-secret", "query-secret"):
            self.assertNotIn(sensitive_value, log_line)


class SessionAuthenticationTimingTests(SimpleTestCase):
    @override_settings(REQUEST_TIMING_ENABLED=False)
    @patch("reservations.authentication.timing_logger.info")
    @patch("rest_framework.authentication.SessionAuthentication.authenticate")
    def test_disabled_timing_delegates_without_logging(
        self,
        authenticate,
        timing_info,
    ):
        expected = (object(), None)
        authenticate.return_value = expected

        result = TimedSessionAuthentication().authenticate(object())

        self.assertIs(result, expected)
        authenticate.assert_called_once()
        timing_info.assert_not_called()

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch("rest_framework.authentication.SessionAuthentication.authenticate")
    def test_enabled_timing_logs_safe_duration(self, authenticate):
        expected = (object(), None)
        authenticate.return_value = expected

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            result = TimedSessionAuthentication().authenticate(object())

        self.assertIs(result, expected)
        self.assertIn("phase=session_authentication", captured.output[0])
        self.assertRegex(captured.output[0], r"duration_ms=\d+\.\d{2}")

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch("rest_framework.authentication.SessionAuthentication.authenticate")
    def test_authentication_exception_is_preserved_and_timed(self, authenticate):
        authenticate.side_effect = RuntimeError("authentication failed")

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            with self.assertRaisesRegex(RuntimeError, "authentication failed"):
                TimedSessionAuthentication().authenticate(object())

        self.assertIn("phase=session_authentication", captured.output[0])


class EndpointTimingTests(SimpleTestCase):
    @override_settings(REQUEST_TIMING_ENABLED=False)
    @patch("reservations.views.timing_logger.info")
    @patch("reservations.views.Resource.objects.all", return_value=[])
    @patch("reservations.views.ResourceSerializer")
    def test_disabled_timing_preserves_response_without_phase_logs(
        self,
        serializer_class,
        _resources,
        timing_info,
    ):
        serializer_class.return_value.data = [{"id": 1}]

        response = ResourceListCreateView().get(SimpleNamespace())

        self.assertEqual(response.data, [{"id": 1}])
        timing_info.assert_not_called()

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch("reservations.views.Resource.objects.all", return_value=[])
    @patch("reservations.views.ResourceSerializer")
    @patch("reservations.views.perf_counter_ns", side_effect=[0, 1_000_000, 3_000_000, 7_000_000])
    def test_resource_handler_and_serializer_timings_have_distinct_boundaries(
        self,
        _clock,
        serializer_class,
        _resources,
    ):
        serializer_class.return_value.data = [{"id": 1}]

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            response = ResourceListCreateView().get(SimpleNamespace())

        self.assertEqual(response.data, [{"id": 1}])
        serializer_log = next(
            line for line in captured.output if "phase=serializer_data" in line
        )
        handler_log = next(
            line for line in captured.output if "phase=view_handler" in line
        )
        self.assertIn("path=/api/resources/", serializer_log)
        self.assertIn("duration_ms=2.00", serializer_log)
        self.assertIn("path=/api/resources/", handler_log)
        self.assertIn("status=200", handler_log)
        self.assertIn("duration_ms=7.00", handler_log)

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch("reservations.views.Resource.objects.all", return_value=[])
    @patch("reservations.views.ResourceSerializer")
    def test_serializer_exception_is_preserved_and_handler_is_timed(
        self,
        serializer_class,
        _resources,
    ):
        type(serializer_class.return_value).data = PropertyMock(
            side_effect=RuntimeError("serialization failed")
        )

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            with self.assertRaisesRegex(RuntimeError, "serialization failed"):
                ResourceListCreateView().get(SimpleNamespace())

        self.assertTrue(
            any("phase=serializer_data" in line for line in captured.output)
        )
        self.assertTrue(
            any(
                "phase=view_handler" in line and "status=exception" in line
                for line in captured.output
            )
        )


class EndpointTimingRequestTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="timing-admin",
            email="timing-admin@example.test",
            password="test-password",
            role=User.ROLE_ADMIN,
        )

    def _get_with_timing_settings(self, enabled, path):
        rest_framework_settings = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_AUTHENTICATION_CLASSES": [
                "reservations.authentication.TimedSessionAuthentication"
            ],
        }
        middleware = [
            "reservations.middleware.RequestTimingMiddleware",
            *settings.MIDDLEWARE,
        ]
        with override_settings(
            REQUEST_TIMING_ENABLED=enabled,
            REST_FRAMEWORK=rest_framework_settings,
            MIDDLEWARE=middleware,
        ):
            client = APIClient()
            client.force_login(self.admin)
            with patch(
                "rest_framework.views.APIView.authentication_classes",
                [TimedSessionAuthentication],
            ):
                if enabled:
                    with self.assertLogs(
                        "reservations.request_timing",
                        level="INFO",
                    ) as captured:
                        response = client.get(path)
                    log_output = captured.output
                else:
                    with (
                        patch("reservations.middleware.logger.info") as middleware_info,
                        patch("reservations.authentication.timing_logger.info") as auth_info,
                        patch("reservations.views.timing_logger.info") as view_info,
                    ):
                        response = client.get(path)
                    middleware_info.assert_not_called()
                    auth_info.assert_not_called()
                    view_info.assert_not_called()
                    log_output = []
        return response, log_output

    def test_real_authenticated_requests_measure_all_three_endpoint_phases(self):
        paths = (
            "/api/resources/",
            "/api/admins/",
            "/api/admin/reservations/",
        )

        for path in paths:
            with self.subTest(path=path):
                response, log_output = self._get_with_timing_settings(True, path)

                self.assertEqual(response.status_code, 200)
                if path == "/api/resources/":
                    self.assertEqual(response.json(), [])
                elif path == "/api/admin/reservations/":
                    self.assertEqual(response.json(), [])
                else:
                    self.assertEqual(
                        response.json()[0]["email"],
                        self.admin.email,
                    )
                combined_logs = "\n".join(log_output)
                self.assertIn("phase=session_authentication", combined_logs)
                self.assertIn(f"phase=serializer_data path={path}", combined_logs)
                self.assertIn(
                    f"phase=view_handler method=GET path={path} status=200",
                    combined_logs,
                )
                self.assertNotIn(self.admin.email, combined_logs)
                self.assertNotIn(self.admin.username, combined_logs)
                self.assertNotIn("test-password", combined_logs)

    def test_disabled_diagnostics_preserve_authenticated_responses_without_logs(self):
        expected_bodies = {
            "/api/resources/": [],
            "/api/admins/": [
                {
                    "id": self.admin.pk,
                    "username": self.admin.username,
                    "email": self.admin.email,
                    "first_name": "",
                    "last_name": "",
                    "role": User.ROLE_ADMIN,
                    "phone": "",
                    "created_at": self.admin.created_at.isoformat().replace(
                        "+00:00",
                        "Z",
                    ),
                }
            ],
            "/api/admin/reservations/": [],
        }

        for path, expected_body in expected_bodies.items():
            with self.subTest(path=path):
                response, log_output = self._get_with_timing_settings(False, path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_body)
                self.assertEqual(log_output, [])

    def test_authenticated_non_admin_still_receives_forbidden_response(self):
        user = User.objects.create_user(
            username="timing-user",
            email="timing-user@example.test",
            password="test-password",
            role=User.ROLE_USER,
        )
        rest_framework_settings = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_AUTHENTICATION_CLASSES": [
                "reservations.authentication.TimedSessionAuthentication"
            ],
        }
        middleware = [
            "reservations.middleware.RequestTimingMiddleware",
            *settings.MIDDLEWARE,
        ]
        with override_settings(
            REQUEST_TIMING_ENABLED=True,
            REST_FRAMEWORK=rest_framework_settings,
            MIDDLEWARE=middleware,
        ):
            client = APIClient()
            client.force_login(user)
            with patch(
                "rest_framework.views.APIView.authentication_classes",
                [TimedSessionAuthentication],
            ):
                with self.assertLogs(
                    "reservations.request_timing",
                    level="INFO",
                ) as captured:
                    response = client.get("/api/admins/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(),
            {"detail": "You do not have permission to perform this action."},
        )
        combined_logs = "\n".join(captured.output)
        self.assertIn("phase=session_authentication", combined_logs)
        self.assertIn("status=403", combined_logs)
        self.assertNotIn("timing-user@example.test", combined_logs)
        self.assertNotIn("timing-user", combined_logs)
        self.assertFalse(
            any("phase=view_handler" in line for line in captured.output)
        )

    def test_handled_view_exception_reports_phase_exception_not_final_http_status(self):
        rest_framework_settings = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_AUTHENTICATION_CLASSES": [
                "reservations.authentication.TimedSessionAuthentication"
            ],
        }
        middleware = [
            "reservations.middleware.RequestTimingMiddleware",
            *settings.MIDDLEWARE,
        ]
        with override_settings(
            REQUEST_TIMING_ENABLED=True,
            REST_FRAMEWORK=rest_framework_settings,
            MIDDLEWARE=middleware,
        ):
            client = APIClient()
            client.force_login(self.admin)
            with patch(
                "rest_framework.views.APIView.authentication_classes",
                [TimedSessionAuthentication],
            ):
                with patch(
                    "reservations.views.UserModel.objects.filter",
                    side_effect=PermissionDenied("private exception detail"),
                ):
                    with self.assertLogs(
                        "reservations.request_timing",
                        level="INFO",
                    ) as captured:
                        response = client.get("/api/admins/")

        self.assertEqual(response.status_code, 403)
        handler_log = next(
            line for line in captured.output if "phase=view_handler" in line
        )
        request_log = next(
            line for line in captured.output if "sql_query_count=" in line
        )
        self.assertIn("path=/api/admins/", handler_log)
        self.assertIn("status=exception", handler_log)
        self.assertIn("status=403", request_log)
        self.assertNotIn("private exception detail", "\n".join(captured.output))

    def test_decorated_view_logs_exception_marker_when_drf_maps_error_to_403(self):
        rest_framework_settings = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_AUTHENTICATION_CLASSES": [
                "reservations.authentication.TimedSessionAuthentication"
            ],
        }
        middleware = [
            "reservations.middleware.RequestTimingMiddleware",
            *settings.MIDDLEWARE,
        ]
        with override_settings(
            REQUEST_TIMING_ENABLED=True,
            REST_FRAMEWORK=rest_framework_settings,
            MIDDLEWARE=middleware,
        ):
            client = APIClient()
            client.force_login(self.admin)
            with patch(
                "rest_framework.views.APIView.authentication_classes",
                [TimedSessionAuthentication],
            ):
                with patch(
                    "reservations.views.Resource.objects.all",
                    side_effect=PermissionDenied("private exception detail"),
                ):
                    with self.assertLogs(
                        "reservations.request_timing",
                        level="INFO",
                    ) as captured:
                        response = client.get("/api/resources/")

        self.assertEqual(response.status_code, 403)
        handler_log = next(
            line for line in captured.output if "phase=view_handler" in line
        )
        self.assertIn("path=/api/resources/", handler_log)
        self.assertIn("status=exception", handler_log)
        self.assertTrue(
            any("path=/api/resources/ status=403" in line for line in captured.output)
        )
        self.assertNotIn("private exception detail", "\n".join(captured.output))


class LoginTimingTests(SimpleTestCase):
    @override_settings(REQUEST_TIMING_ENABLED=False)
    @patch.object(LoginView, "throttle_classes", [])
    @patch("reservations.views.timing_logger.info")
    @patch("reservations.views.login")
    @patch("reservations.views.authenticate")
    @patch("reservations.views.UserSerializer")
    def test_disabled_timing_preserves_login_without_phase_logs(
        self,
        serializer_class,
        authenticate,
        login,
        timing_info,
    ):
        authenticate.return_value = object()
        serializer_class.return_value.data = {"id": 1}
        request = APIRequestFactory().post(
            "/api/auth/login/",
            {"email": "private-user@example.test", "password": "private-password"},
            format="json",
        )

        response = LoginView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        authenticate.assert_called_once()
        login.assert_called_once()
        timing_info.assert_not_called()

    @override_settings(REQUEST_TIMING_ENABLED=True)
    @patch.object(LoginView, "throttle_classes", [])
    @patch("reservations.views.login")
    @patch("reservations.views.authenticate")
    @patch("reservations.views.UserSerializer")
    def test_logs_authentication_and_login_durations_without_credentials(
        self,
        serializer_class,
        authenticate,
        login,
    ):
        authenticate.return_value = object()
        serializer_class.return_value.data = {"id": 1}
        request = APIRequestFactory().post(
            "/api/auth/login/",
            {
                "email": "private-user@example.test",
                "password": "private-password",
            },
            format="json",
        )

        with self.assertLogs("reservations.request_timing", level="INFO") as captured:
            response = LoginView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(authenticate.call_count, 1)
        self.assertEqual(login.call_count, 1)
        self.assertIn("login_phase=authenticate", captured.output[0])
        self.assertIn("login_phase=login", captured.output[1])
        self.assertRegex(captured.output[0], r"duration_ms=\d+\.\d{2}")
        self.assertRegex(captured.output[1], r"duration_ms=\d+\.\d{2}")
        for sensitive_value in ("private-user@example.test", "private-password"):
            self.assertNotIn(sensitive_value, "\n".join(captured.output))
