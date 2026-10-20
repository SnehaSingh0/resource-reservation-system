// Runtime validation coverage for: recent reservations exclude cancelled records.
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../../api/adminApi";
import { AdminDashboardPage } from "./AdminDashboardPage";

vi.mock("../../api/adminApi", () => ({
  adminApi: vi.fn(),
}));

const reservations = [
  {
    id: 1,
    user_email: "active-one@example.com",
    resource_name: "Board Room",
    reservation_date: "2099-01-15",
    start_time: "10:00:00",
    end_time: "11:00:00",
    is_full_day: false,
    created_at: "2098-01-01T10:00:00Z",
    status: "CONFIRMED",
  },
  {
    id: 2,
    user_email: "active-two@example.com",
    resource_name: "Projector",
    reservation_date: "2099-01-16",
    start_time: "11:00:00",
    end_time: "12:00:00",
    is_full_day: false,
    created_at: "2098-01-02T10:00:00Z",
    status: "CONFIRMED",
  },
  {
    id: 3,
    user_email: "active-three@example.com",
    resource_name: "Conference Room",
    reservation_date: "2099-01-17",
    start_time: "12:00:00",
    end_time: "13:00:00",
    is_full_day: false,
    created_at: "2098-01-03T10:00:00Z",
    status: "CONFIRMED",
  },
  {
    id: 4,
    user_email: "cancelled@example.com",
    resource_name: "Board Room",
    reservation_date: "2099-01-18",
    start_time: "13:00:00",
    end_time: "14:00:00",
    is_full_day: false,
    created_at: "2098-01-04T10:00:00Z",
    status: "CANCELLED",
  },
];

describe("AdminDashboardPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(adminApi).mockReset();
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") return [] as T;
      if (path === "/admin/reservations/") return reservations as T;
      if (path === "/admins/") return [] as T;
      return undefined as T;
    });
  });

  it("filters cancelled backend statuses before selecting the three recent records", async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>,
    );
    const table = await screen.findByRole("region", { name: "Recent reservations table" });

    expect(within(table).getByText("active-one@example.com")).toBeTruthy();
    expect(within(table).getByText("active-two@example.com")).toBeTruthy();
    expect(within(table).getByText("active-three@example.com")).toBeTruthy();
    expect(within(table).queryByText("cancelled@example.com")).toBeNull();
  });

  it("renders multi-day timed and full-day reservations as timelines", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") return [] as T;
      if (path === "/admins/") return [] as T;
      if (path === "/admin/reservations/") {
        return [
          {
            ...reservations[0],
            id: 5,
            reservation_date: "2099-10-20",
            end_date: "2099-10-21",
            start_time: "14:00:00",
            end_time: "17:00:00",
          },
          {
            ...reservations[1],
            id: 6,
            reservation_date: "2099-10-20",
            end_date: "2099-10-22",
            start_time: null,
            end_time: null,
            is_full_day: true,
          },
        ] as T;
      }
      return undefined as T;
    });
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>,
    );

    const table = await screen.findByRole("region", { name: "Recent reservations table" });
    expect(within(table).getByText("Oct 20, 14:00 → Oct 21, 17:00")).toBeTruthy();
    expect(within(table).getByText("Oct 20 – Oct 22 • Full Day")).toBeTruthy();
  });

  it("keeps successful dashboard sections available when one request fails", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") throw new Error("Resource request failed.");
      if (path === "/admin/reservations/") return reservations as T;
      if (path === "/admins/") return [{ id: 1 }, { id: 2 }] as T;
      return undefined as T;
    });
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load resources.",
    );
    expect(screen.getByText("Active reservations").parentElement?.textContent).toContain("3");
    expect(screen.getByText("Manage users (2)")).toBeTruthy();
    expect(screen.getByText("Total resources").parentElement?.textContent).toContain("—");
  });
});
