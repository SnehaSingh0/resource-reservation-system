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
  user_email: string;
  resource_name: string;
  reservation_date: string;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

const confirmedReservation: ReservationPayload = {
  id: 1,
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

  it("shows all reservations including cancelled with status badges, without filter controls", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>() => [confirmedReservation, cancelledReservation] as T);
    render(<AdminReservationsPage />);

    // Both active and cancelled reservations are displayed so admins can audit them.
    expect(await screen.findByText("active@example.com")).toBeTruthy();
    expect(await screen.findByText("cancelled@example.com")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getAllByText("Cancelled")).toBeTruthy();
    // No filter dropdown — all reservations are shown by default.
    expect(screen.queryByText("Cancellation History")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Filter reservations by status" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Pending" })).toBeNull();
  });

  it("marks a reservation as cancelled in-place after successful cancellation", async () => {
    let reservationStatus: ReservationPayload["status"] = "CONFIRMED";
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string, options: RequestInit = {}) => {
      if (options.method === "DELETE") {
        reservationStatus = "CANCELLED";
        return undefined as T;
      }
      if (path === "/admin/reservations/") {
        const reservation = { ...confirmedReservation, status: reservationStatus };
        return [reservation] as T;
      }
      return undefined as T;
    });

    render(<AdminReservationsPage />);
    const row = (await screen.findByText("active@example.com")).closest("tr");
    if (!row) throw new Error("Reservation row was not rendered.");
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel reservation" }));

    // After cancellation the row stays visible with a Cancelled status badge.
    // The Cancel button is replaced by a "—" placeholder.
    await waitFor(() => {
      const updatedRow = screen.getByText("active@example.com").closest("tr");
      expect(updatedRow).toBeTruthy();
      expect(within(updatedRow!).getByText("Cancelled")).toBeTruthy();
      expect(within(updatedRow!).queryByRole("button", { name: "Cancel" })).toBeNull();
    });
    expect(screen.getByRole("status").textContent).toBe("Reservation 1 was cancelled.");
    expect(reservationStatus).toBe("CANCELLED");
  });

  it("shows date-only reservations as all day without fabricating times", async () => {
    vi.mocked(adminApi).mockResolvedValue([
      {
        ...confirmedReservation,
        start_time: null,
        end_time: null,
        is_full_day: true,
      },
    ]);
    render(<AdminReservationsPage />);

    expect(await screen.findAllByText("All day")).toHaveLength(2);
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });
});
