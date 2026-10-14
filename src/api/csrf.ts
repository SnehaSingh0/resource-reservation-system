import { apiUrl } from "./apiUrl";

function readCsrfCookie() {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

export async function requireCsrfToken() {
  const cookieToken = readCsrfCookie();
  if (cookieToken) return cookieToken;

  const response = await fetch(apiUrl("/auth/csrf/"), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not prepare a secure request. Refresh and try again.");
  }

  const body: unknown = await response.json().catch(() => null);
  const token =
    typeof body === "object" &&
    body !== null &&
    "csrfToken" in body &&
    typeof body.csrfToken === "string"
      ? body.csrfToken
      : null;
  if (!token) {
    throw new Error("The session security token is unavailable. Refresh and try again.");
  }

  return token;
}
