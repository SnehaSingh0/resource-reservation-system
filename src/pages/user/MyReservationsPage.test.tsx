// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateCachedGets } from "../../api/requestCache";
import { MyReservationsPage } from "./MyReservationsPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 7, email: "user@example.com", role: "USER" },
  }),
}));

describe("MyReservationsPage", () => {
  afterEach(() => {
    cleanup();
    invalidateCachedGets();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("hides cancelled bookings and removes the user's booking after cancellation", async () => {
    let targetExists = true;
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
          targetExists = false;
          return new Response(
            JSON.stringify({ detail: "Reservation cancelled and permanently removed." }),
            {
            status: 200,
            headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (url.includes("/reservations/")) {
          return new Response(
            JSON.stringify([
              ...(targetExists
                ? [{
                id: 3,
                resource: 1,
                resource_name: "Board Room",
                reservation_date: "2099-01-15",
                end_date: null,
                start_time: "10:00:00",
                end_time: "11:00:00",
                is_full_day: false,
                status: "CONFIRMED",
                }]
                : []),
              {
                id: 4,
                resource: 2,
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

    render(
      <StrictMode>
        <MyReservationsPage />
      </StrictMode>,
    );

    expect(await screen.findByText("Board Room")).toBeTruthy();
    expect(screen.queryByText("Previously Cancelled Room")).toBeNull();
    expect(screen.queryByRole("heading", { name: /upcoming reservations/i })).toBeNull();
    expect(screen.getByText("Jan 15, 2099 • 10:00–11:00")).toBeTruthy();

    const row = screen.getByText("Board Room").closest("tr");
    if (!row) throw new Error("Reservation row was not rendered.");
    expect(
      Array.from(row.querySelectorAll("td"), (cell) => cell.getAttribute("data-label")),
    ).toEqual(["Resource", "Reservation", "Status", "Actions"]);
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel booking" }));

    await waitFor(() => {
      expect(screen.queryByText("Board Room")).toBeNull();
    });
    expect(screen.getByText("No reservations are available yet.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Reservation cancelled and permanently removed.",
    );
    expect(targetExists).toBe(false);
    expect(
      vi.mocked(fetch).mock.calls.filter(([input, init]) =>
        String(input).includes("/reservations/") && init?.method !== "DELETE",
      ),
    ).toHaveLength(1);
  });
});
