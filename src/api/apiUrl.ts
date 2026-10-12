const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredApiBaseUrl ||
  (import.meta.env.DEV ? "http://localhost:8000/api" : "")
).replace(/\/+$/, "");

export function apiUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error(
      "The API URL is not configured. Set VITE_API_BASE_URL to the backend API URL.",
    );
  }

  return `${API_BASE_URL}${path}`;
}
