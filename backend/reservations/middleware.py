import logging
import re
from time import perf_counter_ns

from django.conf import settings
from django.db import connection


logger = logging.getLogger("reservations.request_timing")

_SQL_COMMENTS = re.compile(r"/\*.*?\*/|--[^\r\n]*", re.DOTALL)
_SQL_STRING_LITERALS = re.compile(r"'(?:''|\\.|[^'\\])*'")
_SQL_DOLLAR_QUOTED_LITERALS = re.compile(
    r"\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*|)\$.*?\$(?P=tag)\$", re.DOTALL
)
_SQL_NUMERIC_LITERALS = re.compile(
    r"(?<![\w.])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![\w.])"
)


def _safe_sql_for_logging(sql):
    sql = _SQL_STRING_LITERALS.sub("?", sql)
    sql = _SQL_DOLLAR_QUOTED_LITERALS.sub("?", sql)
    sql = _SQL_COMMENTS.sub(" ", sql)
    sql = _SQL_NUMERIC_LITERALS.sub("?", sql)
    return " ".join(sql.split())


class RequestTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.REQUEST_TIMING_ENABLED:
            return self.get_response(request)

        started_at = perf_counter_ns()
        sql_metrics = {"query_count": 0, "duration_ns": 0}
        log_sql_statements = (
            request.method == "GET" and request.path_info == "/api/resources/"
        ) or (
            request.method in {"GET", "POST"}
            and request.path_info == "/api/reservations/"
        )

        def time_query(execute, sql, params, many, context):
            query_started_at = perf_counter_ns()
            try:
                return execute(sql, params, many, context)
            finally:
                sql_metrics["query_count"] += 1
                query_duration_ns = perf_counter_ns() - query_started_at
                sql_metrics["duration_ns"] += query_duration_ns
                if log_sql_statements:
                    logger.info(
                        "sql_query=%d sql_duration_ms=%.2f sql=%s",
                        sql_metrics["query_count"],
                        query_duration_ns / 1_000_000,
                        _safe_sql_for_logging(sql),
                    )

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
