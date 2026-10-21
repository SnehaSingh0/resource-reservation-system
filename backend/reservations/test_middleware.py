from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import resolve
from rest_framework.test import APIRequestFactory

from .middleware import RequestTimingMiddleware
from .views import LoginView


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
        for sensitive_value in ("SELECT", "sql-parameter-secret", "query-secret"):
            self.assertNotIn(sensitive_value, log_line)


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
