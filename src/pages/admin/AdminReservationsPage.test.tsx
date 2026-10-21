// Runtime validation coverage for: reservation management and cancellation.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../../api/adminApi";
import { AdminReservationsPage } from "./AdminReservationsPage";

vi.mock("../../api/adminApi", () => ({
  adminApi: vi.fn(),
}));

type ReservationPayload = {
  id: number;
  resource: number;
  user_email: string;
  resource_name: string;
  reservation_date: string;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  end_date?: string | null;
};

const confirmedReservation: ReservationPayload = {
  id: 1,
  resource: 7,
  user_email: "active@example.com",
  resource_name: "Board Room",
  reservation_date: "2099-01-15",
  start_time: "10:00:00",
  end_time: "11:00:00",
  is_full_day: false,
  status: "CONFIRMED",
};

const cancelledReservation: ReservationPayload = {
  ...confirmedReservation,
  id: 2,
  user_email: "cancelled@example.com",
  status: "CANCELLED",
};

describe("AdminReservationsPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(adminApi).mockReset();
  });

  it("shows active reservations but excludes cancelled records", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>() => [confirmedReservation, cancelledReservation] as T);
    render(<AdminReservationsPage />);

    expect(await screen.findByText("active@example.com")).toBeTruthy();
    expect(screen.getByText("Jan 15, 2099 • 10:00–11:00")).toBeTruthy();
    expect(screen.queryByText("cancelled@example.com")).toBeNull();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText("Cancelled")).toBeNull();
    expect(screen.getByRole("heading", { name: "Active reservations" })).toBeTruthy();
    expect(screen.queryByText("Cancellation History")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Filter reservations by status" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Pending" })).toBeNull();
  });

  it("removes a reservation after successful cancellation and keeps it excluded after reload", async () => {
    let reservationExists = true;
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string, options: RequestInit = {}) => {
      if (options.method === "DELETE") {
        reservationExists = false;
        return undefined as T;
      }
      if (path === "/admin/reservations/") {
        return (reservationExists ? [confirmedReservation] : []) as T;
      }
      return undefined as T;
    });

    const page = render(<AdminReservationsPage />);
    const row = (await screen.findByText("active@example.com")).closest("tr");
    if (!row) throw new Error("Reservation row was not rendered.");
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel reservation" }));

    await waitFor(() => {
      expect(screen.queryByText("active@example.com")).toBeNull();
      expect(screen.getByText("No active reservations found.")).toBeTruthy();
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Reservation 1 was cancelled and removed.",
    );
    expect(reservationExists).toBe(false);
    expect(adminApi).toHaveBeenCalledWith(
      "/admin/reservations/1/",
      { method: "DELETE" },
      "Could not cancel this reservation.",
    );

    page.unmount();
    render(<AdminReservationsPage />);
    expect(await screen.findByText("No active reservations found.")).toBeTruthy();
    expect(screen.queryByText("active@example.com")).toBeNull();
  });

  it("formats multi-day timed and full-day reservations as readable timelines", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>() => [
      {
        ...confirmedReservation,
        end_date: "2099-01-17",
        start_time: "14:00:00",
        end_time: "17:00:00",
      },
      {
        ...confirmedReservation,
        id: 3,
        end_date: "2099-01-17",
        start_time: null,
        end_time: null,
        is_full_day: true,
      },
    ] as T);
    render(<AdminReservationsPage />);

    expect(
      await screen.findByText("Jan 15, 14:00 → Jan 17, 17:00"),
    ).toBeTruthy();
    expect(screen.getByText("Jan 15 – Jan 17 • Full Day")).toBeTruthy();
  });
});
