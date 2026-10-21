import logging
from time import perf_counter_ns

from django.conf import settings
from django.db import connection


logger = logging.getLogger("reservations.request_timing")


class RequestTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.REQUEST_TIMING_ENABLED:
            return self.get_response(request)

        started_at = perf_counter_ns()
        sql_metrics = {"query_count": 0, "duration_ns": 0}

        def time_query(execute, sql, params, many, context):
            query_started_at = perf_counter_ns()
            try:
                return execute(sql, params, many, context)
            finally:
                sql_metrics["query_count"] += 1
                sql_metrics["duration_ns"] += perf_counter_ns() - query_started_at

        response = None
        try:
            with connection.execute_wrapper(time_query):
                response = self.get_response(request)
            return response
        finally:
            duration_ms = (perf_counter_ns() - started_at) / 1_000_000
            sql_duration_ms = sql_metrics["duration_ns"] / 1_000_000

            route = getattr(getattr(request, "resolver_match", None), "route", None)
            path = f"/{route}" if route is not None else "<unresolved>"
            status_code = response.status_code if response is not None else "exception"
            logger.info(
                "method=%s path=%s status=%s duration_ms=%.2f "
                "sql_query_count=%d sql_duration_ms=%.2f",
                request.method,
                path,
                status_code,
                duration_ms,
                sql_metrics["query_count"],
                sql_duration_ms,
            )
