import logging
from time import perf_counter_ns


logger = logging.getLogger("reservations.request_timing")


class RequestTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started_at = perf_counter_ns()
        response = self.get_response(request)
        duration_ms = (perf_counter_ns() - started_at) / 1_000_000

        route = getattr(getattr(request, "resolver_match", None), "route", None)
        path = f"/{route}" if route is not None else "<unresolved>"
        logger.info(
            "method=%s path=%s status=%d duration_ms=%.2f",
            request.method,
            path,
            response.status_code,
            duration_ms,
        )
        return response
