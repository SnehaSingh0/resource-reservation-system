import type { Reservation } from "./demoData";

const STORAGE_KEY = "resource-reservation-demo-session";

export function getSessionReservations(): Reservation[] {
  const value = sessionStorage.getItem(STORAGE_KEY);
  if (!value) return [];

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Demo reservations in session storage are invalid.");
  }

  return parsed.map((item): Reservation => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("id" in item) ||
      !("user" in item) ||
      !("resource" in item) ||
      !("date" in item) ||
      !("startTime" in item) ||
      !("endTime" in item) ||
      !("status" in item) ||
      typeof item.id !== "string" ||
      typeof item.user !== "string" ||
      typeof item.resource !== "string" ||
      typeof item.date !== "string" ||
      typeof item.startTime !== "string" ||
      typeof item.endTime !== "string" ||
      (item.status !== "Confirmed" &&
        item.status !== "Pending" &&
        item.status !== "Cancelled")
    ) {
      throw new Error("A demo reservation in session storage is invalid.");
    }
    return item;
  });
}

export function saveSessionReservations(reservations: Reservation[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reservations));
}
