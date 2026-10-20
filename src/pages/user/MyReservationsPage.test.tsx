// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyReservationsPage } from "./MyReservationsPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 7, email: "user@example.com", role: "USER" },
  }),
}));

describe("MyReservationsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("shows cancelled bookings so users can confirm their cancellation was recorded", async () => {
    let targetStatus = "CONFIRMED";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (url.includes("/auth/csrf/")) {
          return new Response(JSON.stringify({ csrfToken: "csrf-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/reservations/3/") && init.method === "DELETE") {
          targetStatus = "CANCELLED";
          return new Response(null, { status: 204 });
        }
        if (url.includes("/reservations/")) {
          return new Response(
            JSON.stringify([
              {
                id: 3,
                resource_name: "Board Room",
                reservation_date: "2099-01-15",
                end_date: null,
                start_time: "10:00:00",
                end_time: "11:00:00",
                is_full_day: false,
                status: targetStatus,
              },
              {
                id: 4,
                resource_name: "Previously Cancelled Room",
                reservation_date: "2099-01-16",
                start_time: "11:00:00",
                end_time: "12:00:00",
                is_full_day: false,
                status: "CANCELLED",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<MyReservationsPage />);

    // Cancelled bookings are displayed so the user can confirm cancellation was recorded.
    expect(await screen.findByText("Board Room")).toBeTruthy();
    expect(await screen.findByText("Previously Cancelled Room")).toBeTruthy();

    // Cancel the Board Room booking.
    const row = screen.getByText("Board Room").closest("tr");
    if (!row) throw new Error("Reservation row was not rendered.");
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel booking" }));

    // After cancellation the Board Room row disappears from the local state
    // (the component removes it from its in-memory list after a successful DELETE).
    await waitFor(() => {
      expect(screen.queryByText("Board Room")).toBeNull();
    });
    // Previously Cancelled Room remains visible throughout.
    expect(screen.getByText("Previously Cancelled Room")).toBeTruthy();
    expect(targetStatus).toBe("CANCELLED");
  });
});
