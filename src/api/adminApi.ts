import { apiUrl } from "./apiUrl";

function getCsrfToken() {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

async function requireCsrfToken() {
  let token = getCsrfToken();
  if (!token) {
    const response = await fetch(apiUrl("/auth/csrf/"), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Could not prepare a secure request. Refresh and try again.");
    }
    token = getCsrfToken();
  }
  if (!token) {
    throw new Error("The session security token is unavailable. Refresh and try again.");
  }
  return token;
}

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

  const response = await fetch(apiUrl(path), {
    ...options,
    method,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(describeApiError(payload, fallback));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
