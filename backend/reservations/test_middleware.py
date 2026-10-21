from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from .middleware import RequestTimingMiddleware


class RequestTimingMiddlewareTests(SimpleTestCase):
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
