import { apiUrl } from "./apiUrl";
import { requireCsrfToken } from "./csrf";
import { cachedGet, invalidateCachedGets } from "./requestCache";

function describeApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const values = Object.values(payload as Record<string, unknown>);
  const messages = values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return [];
  });
  return messages.length ? messages.join(" ") : fallback;
}

export async function adminApi<T>(
  path: string,
  options: RequestInit = {},
  fallback = "The request could not be completed.",
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    headers.set("X-CSRFToken", await requireCsrfToken());
  }

  const url = apiUrl(path);
  const request = async () => {
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: "include",
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(describeApiError(payload, fallback));
    }
    if (method !== "GET") {
      if (
        path.startsWith("/resources/") ||
        path.startsWith("/resource-constraints/")
      ) {
        invalidateCachedGets(apiUrl("/resources/"));
      } else if (
        path.startsWith("/reservations/") ||
        path.startsWith("/admin/reservations/")
      ) {
        invalidateCachedGets(
          apiUrl("/reservations/"),
          `:${apiUrl("/reservations/")}`,
          apiUrl("/admin/reservations/"),
        );
      } else if (path.startsWith("/admins/")) {
        invalidateCachedGets(apiUrl("/admins/"));
      }
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  if (method !== "GET" || options.signal) return request();

  const cacheDurationMs =
    path === "/resources/"
      ? 15_000
      : path === "/resources/constraints/" ||
          /^\/resources\/\d+\/constraints\/?$/.test(path)
        ? 60_000
        : 0;
  return cachedGet(url, request, cacheDurationMs);
}
