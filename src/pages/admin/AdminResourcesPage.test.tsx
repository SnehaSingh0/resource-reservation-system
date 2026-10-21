// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../../api/adminApi";
import { AdminResourcesPage } from "./AdminResourcesPage";

vi.mock("../../api/adminApi", () => ({
  adminApi: vi.fn(),
}));

const resources = [
  {
    id: 1,
    name: "Board Room",
    resource_type: "Room",
    description: "",
    location: "Floor 1",
    is_active: true,
    default_start_time: "09:00:00",
    default_end_time: "18:00:00",
  },
  {
    id: 2,
    name: "Projector",
    resource_type: "Equipment",
    description: "",
    location: "Floor 2",
    is_active: true,
    default_start_time: "00:00:00",
    default_end_time: "23:59:00",
  },
];

describe("AdminResourcesPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(adminApi).mockReset();
  });

  it("keeps resources visible when one availability request fails", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") return resources as T;
      if (path === "/resources/1/constraints/") {
        throw new Error("Could not load availability for Board Room.");
      }
      return [] as T;
    });
    render(
      <MemoryRouter>
        <AdminResourcesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Board Room")).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
    expect(screen.getByText("Could not load availability for Board Room.")).toBeTruthy();
    expect(screen.getByText("All week · Full day")).toBeTruthy();
  });

  it("shows a progressive-disclosure weekly schedule for variable hours", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") return [resources[1]] as T;
      if (path === "/resources/2/constraints/") {
        return [
          {
            id: 1,
            resource: 2,
            day_of_week: 0,
            start_time: "08:30:00",
            end_time: "12:00:00",
            is_full_day: false,
            is_active: true,
          },
          {
            id: 3,
            resource: 2,
            day_of_week: 0,
            start_time: "1:00 PM",
            end_time: "5:00 PM",
            is_full_day: false,
            is_active: true,
          },
          {
            id: 2,
            resource: 2,
            day_of_week: 4,
            start_time: "00:00:00",
            end_time: "23:59:00",
            is_full_day: true,
            is_active: true,
          },
        ] as T;
      }
      return [] as T;
    });
    render(
      <MemoryRouter>
        <AdminResourcesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Varies ·")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = await screen.findByRole("dialog", {
      name: "Weekly availability details",
    });
    expect(details.textContent).toContain("Monday");
    expect(details.textContent).toContain("08:30 – 12:00, 13:00 – 17:00");
    expect(details.textContent).toContain("Friday");
    expect(details.textContent).toContain("Full Day");
    expect(details.textContent).toContain("Sunday");
    expect(details.textContent).toContain("🚫 Un-available");
    expect(details.querySelectorAll(".availability-details-row")).toHaveLength(7);
  });

  it("groups identical default hours across consecutive weekdays", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") {
        return [
          {
            ...resources[0],
            default_start_time: "9:00 AM",
            default_end_time: "6:00 PM",
          },
        ] as T;
      }
      return [] as T;
    });
    render(
      <MemoryRouter>
        <AdminResourcesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Mon–Sun • 09:00 – 18:00")).toBeTruthy();
  });

  it("groups consecutive custom full-day availability in a compact summary", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string) => {
      if (path === "/resources/") return [resources[0]] as T;
      if (path === "/resources/1/constraints/") {
        return [0, 1, 2, 3, 4].map((day, id) => ({
          id,
          resource: 1,
          day_of_week: day,
          start_time: "00:00:00",
          end_time: "23:59:00",
          is_full_day: true,
          is_active: true,
        })) as T;
      }
      return [] as T;
    });
    render(
      <MemoryRouter>
        <AdminResourcesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Mon–Fri · Full day")).toBeTruthy();
    expect(screen.queryByText(/24\/7|Always Available/)).toBeNull();
  });

  it("confirms permanent resource deletion and its cascading reservation impact", async () => {
    let exists = true;
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string, options: RequestInit = {}) => {
      if (path === "/resources/" && options.method !== "DELETE") {
        return (exists ? resources : [resources[1]]) as T;
      }
      if (path.endsWith("/constraints/")) return [] as T;
      if (path === "/resources/1/" && options.method === "DELETE") {
        exists = false;
        return undefined as T;
      }
      return [] as T;
    });
    render(
      <MemoryRouter>
        <AdminResourcesPage />
      </MemoryRouter>,
    );

    const boardRoomRow = await screen.findByRole("row", { name: /Board Room/ });
    fireEvent.click(within(boardRoomRow).getByRole("button", { name: "Delete" }));
    expect(
      screen.getByText(/all related reservations, including current or upcoming bookings/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete resource" }));

    await waitFor(() => expect(exists).toBe(false));
    expect(screen.queryByText("Board Room")).toBeNull();
    expect(screen.getByText("Projector")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Board Room was deleted.");

    const requests = vi.mocked(adminApi).mock.calls;
    expect(requests.filter(([path]) => path === "/resources/")).toHaveLength(1);
    expect(
      requests.filter(([path]) => path === "/resources/1/constraints/"),
    ).toHaveLength(1);
    expect(
      requests.filter(([path]) => path === "/resources/2/constraints/"),
    ).toHaveLength(1);
  });
});
