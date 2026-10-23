// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateCachedGets } from "../../api/requestCache";
import { ResourcesPage } from "./ResourcesPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 4,
      username: "booker",
      email: "booker@example.com",
      first_name: "Book",
      last_name: "User",
      role: "USER",
    },
  }),
}));

vi.mock("../../api/csrf", () => ({
  requireCsrfToken: vi.fn(async () => "csrf-token"),
}));

const timedResource = {
  id: 10,
  name: "Timed Room",
  resource_type: "Room",
  description: "",
  location: "Building A",
  is_active: true,
  default_start_time: "09:00:00",
  default_end_time: "18:00:00",
};

const fullDayResource = {
  ...timedResource,
  id: 11,
  name: "All Day Hall",
};

type MockBooking = {
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

function createConstraints(
  resourceId: number,
  weekdays: number[],
  isFullDay: boolean,
) {
  return weekdays.map((day, index) => ({
    id: resourceId * 10 + index,
    resource: resourceId,
    day_of_week: day,
    start_time: isFullDay ? "00:00:00" : "09:00:00",
    end_time: isFullDay ? "23:59:00" : "18:00:00",
    is_full_day: isFullDay,
    is_active: true,
  }));
}

function mockReservationApi(
  resources: typeof timedResource[],
  constraintsByResource: Record<number, ReturnType<typeof createConstraints>>,
  bookings: MockBooking[] = [],
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });

      const constraintMatch = /\/resources\/(\d+)\/constraints\/?$/.exec(url);
      let body: unknown = {};
      if (url.endsWith("/resources/")) {
        body = resources;
      } else if (constraintMatch) {
        body = constraintsByResource[Number(constraintMatch[1])] ?? [];
      } else if (url.includes("/availability/")) {
        body = { bookings };
      } else if (url.endsWith("/reservations/") && init?.method === "POST") {
        body = {
          id: 21,
          status: "CONFIRMED",
          is_full_day: true,
          start_time: null,
          end_time: null,
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }),
  );
  return requests;
}

function renderResourcesPage() {
  return render(
    <MemoryRouter>
      <ResourcesPage />
    </MemoryRouter>,
  );
}

async function chooseReservationDate(label: string, date: string) {
  fireEvent.click(await screen.findByLabelText(label));
  const dialog = await screen.findByRole("dialog", {
    name: `Choose ${label} date`,
  });
  const targetMonth = date.slice(0, 7);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const visibleMonth = dialog.getAttribute("data-visible-month") ?? "";
    if (visibleMonth === targetMonth) break;
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: visibleMonth < targetMonth ? "Next month" : "Previous month",
      }),
    );
    await waitFor(() => {
      expect(dialog.getAttribute("data-visible-month")).not.toBe(visibleMonth);
    });
  }

  const dateButton = dialog.querySelector<HTMLButtonElement>(
    `[data-date="${date}"]`,
  );
  if (!dateButton) throw new Error(`Date ${date} was not present in the picker.`);
  fireEvent.click(dateButton);
}

function projectDateKey(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("ResourcesPage reservation form", () => {
  afterEach(() => {
    cleanup();
    invalidateCachedGets();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("deduplicates initial resource and availability requests under StrictMode", async () => {
    const requests = mockReservationApi([timedResource], {
      [timedResource.id]: createConstraints(
        timedResource.id,
        [0, 1, 2, 3, 4, 5, 6],
        false,
      ),
    });
    render(
      <StrictMode>
        <MemoryRouter>
          <ResourcesPage />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByLabelText("Reserve date")).toBeTruthy();
    await waitFor(() => {
      expect(
        requests.filter(({ url }) => url.includes("/availability/")),
      ).toHaveLength(1);
    });
    expect(requests.filter(({ url }) => url.endsWith("/resources/"))).toHaveLength(1);
    expect(
      requests.filter(({ url }) => url.endsWith("/resources/10/constraints/")),
    ).toHaveLength(1);
  });

  it("shows one date and only start/end time fields for a timed single-day resource", async () => {
    mockReservationApi([timedResource], {
      [timedResource.id]: createConstraints(timedResource.id, [0, 1, 2, 3, 4, 5, 6], false),
    });
    renderResourcesPage();

    expect(await screen.findByLabelText("Reserve date")).toBeTruthy();
    expect(screen.getByLabelText("Start Time")).toBeTruthy();
    expect(screen.getByLabelText("End Time")).toBeTruthy();
    expect(screen.queryByLabelText("Reserve Until")).toBeNull();
    expect(screen.queryByRole("group", { name: "Set reservation duration" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Reserve all day" })).toBeNull();
    expect(screen.getByLabelText("Start Time").tagName).toBe("SELECT");
    expect(screen.getByLabelText("End Time").tagName).toBe("SELECT");
  });

  it("submits a multi-day full-day reservation with dates and no time controls", async () => {
    const requests = mockReservationApi([fullDayResource], {
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4, 5, 6], true),
    });
    renderResourcesPage();

    const reserveFrom = await screen.findByLabelText("Reserve From");
    const reserveUntil = screen.getByLabelText("Reserve Until");
    expect(reserveFrom.tagName).toBe("BUTTON");
    expect(reserveUntil.tagName).toBe("BUTTON");
    expect(screen.queryByLabelText("Start Time")).toBeNull();
    expect(screen.queryByLabelText("End Time")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Reserve all day" })).toBeNull();

    await chooseReservationDate("Reserve From", "2026-10-30");
    await chooseReservationDate("Reserve Until", "2026-11-01");
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    await waitFor(() => {
      expect(screen.queryByText("Updating availability…")).toBeNull();
    });
    const availabilityRequestsBeforeReservation = requests.filter(({ url }) =>
      url.includes("/availability/"),
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() => {
      expect(requests.some(
        ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
      )).toBe(true);
    });
    const createRequest = requests.find(
      ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
    );
    const payload = JSON.parse(String(createRequest?.init?.body));
    expect(payload).toMatchObject({
      reservation_date: "2026-10-30",
      end_date: "2026-11-01",
      start_time: null,
      end_time: null,
      is_full_day: true,
    });
    expect(await screen.findByText(/reserved all day for/)).toBeTruthy();
    await waitFor(() => {
      expect(
        requests.filter(({ url }) => url.includes("/availability/")),
      ).toHaveLength(availabilityRequestsBeforeReservation + 1);
    });
  });

  it("rejects past dates and past time slots today but allows a future slot today", async () => {
    const today = projectDateKey();
    const fixedNow = Date.parse(`${today}T12:00:00Z`);
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const requests = mockReservationApi([timedResource], {
      [timedResource.id]: createConstraints(
        timedResource.id,
        [0, 1, 2, 3, 4, 5, 6],
        false,
      ),
    });
    renderResourcesPage();

    await chooseReservationDate("Reserve date", shiftDateKey(today, -1));
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    expect(
      await screen.findByText("Reservations cannot be made for past dates."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve" }).hasAttribute("disabled")).toBe(true);

    await chooseReservationDate("Reserve date", today);
    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("End Time"), {
      target: { value: "10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    expect(
      await screen.findByText("Reservations for today must start at a future time."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "13:00" },
    });
    fireEvent.change(screen.getByLabelText("End Time"), {
      target: { value: "14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    expect(screen.getByRole("button", { name: "Reserve" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
        ),
      ).toBe(true);
    });
    const createRequest = requests.find(
      ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
    );
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      reservation_date: today,
      end_date: today,
      start_time: "13:00",
      end_time: "14:00",
      is_full_day: false,
    });
  });

  it("prevents selecting a time range that overlaps an existing reservation", async () => {
    const reservationDate = shiftDateKey(projectDateKey(), 1);
    mockReservationApi(
      [timedResource],
      {
        [timedResource.id]: createConstraints(
          timedResource.id,
          [0, 1, 2, 3, 4, 5, 6],
          false,
        ),
      },
      [{
        date: reservationDate,
        start_time: "13:00:00",
        end_time: "14:00:00",
        is_full_day: false,
        status: "CONFIRMED",
      }],
    );
    renderResourcesPage();

    await chooseReservationDate("Reserve date", reservationDate);
    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "13:00" },
    });
    fireEvent.change(screen.getByLabelText("End Time"), {
      target: { value: "14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));

    expect(
      await screen.findByText(
        "The selected time overlaps an existing reservation for Timed Room.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve" }).hasAttribute("disabled"))
      .toBe(true);
  });

  it("submits a permitted multi-day timed reservation using the selected boundary times", async () => {
    const constraints = [
      ...createConstraints(timedResource.id, [0, 1, 2, 3, 4, 5, 6], true),
      {
        id: 999,
        resource: timedResource.id,
        day_of_week: 0,
        start_time: "09:00:00",
        end_time: "18:00:00",
        is_full_day: false,
        is_active: true,
      },
    ];
    const requests = mockReservationApi([timedResource], {
      [timedResource.id]: constraints,
    });
    renderResourcesPage();

    await chooseReservationDate("Reserve From", "2026-10-23");
    await chooseReservationDate("Reserve Until", "2026-10-25");
    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("End Time"), {
      target: { value: "10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    expect(screen.getByRole("button", { name: "Reserve" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() => {
      expect(requests.some(
        ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
      )).toBe(true);
    });
    const createRequest = requests.find(
      ({ url, init }) => url.endsWith("/reservations/") && init?.method === "POST",
    );
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      reservation_date: "2026-10-23",
      end_date: "2026-10-25",
      start_time: "17:00",
      end_time: "10:00",
      is_full_day: false,
    });
  });

  it("validates every day in a full-day date range against saved weekdays", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T12:00:00Z"));
    mockReservationApi([fullDayResource], {
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4], true),
    });
    renderResourcesPage();

    await chooseReservationDate("Reserve From", "2026-10-23");
    await chooseReservationDate("Reserve Until", "2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));

    expect(
      await screen.findByText(
        /not configured for full-day reservations on every selected date/i,
      ),
    ).toBeTruthy();
  });

  it("updates the visible reservation fields when the selected resource changes", async () => {
    mockReservationApi([timedResource, fullDayResource], {
      [timedResource.id]: createConstraints(timedResource.id, [0, 1, 2, 3, 4, 5, 6], false),
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4, 5, 6], true),
    });
    renderResourcesPage();

    expect(await screen.findByLabelText("Reserve date")).toBeTruthy();
    const resourceSelect = screen.getByLabelText("Resource");
    fireEvent.change(resourceSelect, { target: { value: String(fullDayResource.id) } });

    expect(await screen.findByLabelText("Reserve From")).toBeTruthy();
    expect(screen.getByLabelText("Reserve Until")).toBeTruthy();
    expect(screen.queryByLabelText("Start Time")).toBeNull();
    expect(screen.queryByLabelText("End Time")).toBeNull();

    fireEvent.change(resourceSelect, { target: { value: String(timedResource.id) } });
    expect(await screen.findByLabelText("Reserve date")).toBeTruthy();
    expect(screen.getByLabelText("Start Time")).toBeTruthy();
    expect(screen.getByLabelText("End Time")).toBeTruthy();
    expect(screen.queryByLabelText("Reserve Until")).toBeNull();
  });

  it("opens a compact date picker outside the calendar panel and dismisses with Escape", async () => {
    mockReservationApi([fullDayResource], {
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4, 5, 6], true),
    });
    renderResourcesPage();

    const dateTrigger = await screen.findByLabelText("Reserve From");
    fireEvent.click(dateTrigger);
    const picker = await screen.findByRole("dialog", {
      name: "Choose Reserve From date",
    });
    expect(picker.parentElement).toBe(document.body);
    expect(picker.className).toContain("reservation-date-picker-popover");
    expect(picker.querySelectorAll(".reservation-date-picker-day")).toHaveLength(42);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", {
      name: "Choose Reserve From date",
    })).toBeNull();
    expect(document.activeElement).toBe(dateTrigger);
  });

  it("offers only time choices inside the selected weekday availability windows", async () => {
    const mondayWindows = [
      {
        id: 1001,
        resource: timedResource.id,
        day_of_week: 0,
        start_time: "09:00:00",
        end_time: "12:00:00",
        is_full_day: false,
        is_active: true,
      },
      {
        id: 1002,
        resource: timedResource.id,
        day_of_week: 0,
        start_time: "14:00:00",
        end_time: "17:00:00",
        is_full_day: false,
        is_active: true,
      },
    ];
    mockReservationApi([timedResource], {
      [timedResource.id]: mondayWindows,
    });
    renderResourcesPage();

    const startTime = await screen.findByLabelText("Start Time") as HTMLSelectElement;
    const endTime = screen.getByLabelText("End Time") as HTMLSelectElement;
    await chooseReservationDate("Reserve date", "2026-10-26");

    await waitFor(() => {
      const startValues = Array.from(startTime.options, (option) => option.value);
      expect(startValues).toContain("09:00");
      expect(startValues).toContain("11:45");
      expect(startValues).toContain("14:00");
      expect(startValues).not.toContain("12:00");
      expect(startValues).not.toContain("13:00");
      expect(startValues).not.toContain("17:00");
    });
    expect(Array.from(endTime.options, (option) => option.value)).toContain("12:00");
    expect(Array.from(endTime.options, (option) => option.value)).not.toContain("13:00");

    fireEvent.change(startTime, { target: { value: "11:00" } });
    await waitFor(() => {
      const endValues = Array.from(endTime.options, (option) => option.value);
      expect(endValues).toContain("12:00");
      expect(endValues).not.toContain("14:00");
    });

    await chooseReservationDate("Reserve date", "2026-10-27");
    await waitFor(() => {
      expect(startTime.disabled).toBe(true);
      expect(endTime.disabled).toBe(true);
    });
    expect(
      screen.getByRole("button", {
        name: /Tuesday, October 27: unavailable availability/,
      }).className,
    ).toContain("unavailable-day");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const unavailableTuesday = Array.from(
      document.querySelectorAll(".time-grid-day-header"),
    ).find((header) => header.textContent?.includes("Tue"));
    expect(unavailableTuesday?.className).toContain("unavailable-day");
  });

  it("restores the selected resource after navigating away and returning", async () => {
    const requests = mockReservationApi([timedResource, fullDayResource], {
      [timedResource.id]: createConstraints(timedResource.id, [0, 1, 2, 3, 4, 5, 6], false),
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4, 5, 6], true),
    });
    const firstVisit = renderResourcesPage();

    const resourceSelect = await screen.findByLabelText("Resource") as HTMLSelectElement;
    fireEvent.change(resourceSelect, {
      target: { value: String(fullDayResource.id) },
    });
    await screen.findByLabelText("Reserve From");
    expect(window.sessionStorage.getItem("resource-reservation.selected-resource"))
      .toBe(String(fullDayResource.id));

    firstVisit.unmount();
    renderResourcesPage();
    const restoredResource = await screen.findByLabelText("Resource") as HTMLSelectElement;
    await screen.findByLabelText("Reserve Until");
    expect(restoredResource.value).toBe(String(fullDayResource.id));
    expect(requests.filter(({ url }) => url.endsWith("/resources/")).length).toBe(1);
    expect(
      requests.filter(({ url }) => /\/resources\/\d+\/constraints\/$/.test(url)),
    ).toHaveLength(2);
    expect(requests.filter(({ url }) => url.includes("/availability/"))).toHaveLength(3);
  });

  it("falls back to an available resource when the saved selection no longer exists", async () => {
    window.sessionStorage.setItem("resource-reservation.selected-resource", "999");
    mockReservationApi([timedResource, fullDayResource], {
      [timedResource.id]: createConstraints(timedResource.id, [0, 1, 2, 3, 4, 5, 6], false),
      [fullDayResource.id]: createConstraints(fullDayResource.id, [0, 1, 2, 3, 4, 5, 6], true),
    });
    renderResourcesPage();

    const resourceSelect = await screen.findByLabelText("Resource") as HTMLSelectElement;
    await screen.findByLabelText("Reserve date");
    expect(resourceSelect.value).toBe(String(timedResource.id));
    expect(window.sessionStorage.getItem("resource-reservation.selected-resource"))
      .toBe(String(timedResource.id));
  });

  it("keeps the month calendar open after selecting a date and supports month navigation", async () => {
    let availabilityRequests = 0;
    let releaseNextAvailability: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        let body: unknown = {};
        if (url.endsWith("/resources/")) {
          body = [timedResource];
        } else if (url.endsWith(`/resources/${timedResource.id}/constraints/`)) {
          body = createConstraints(
            timedResource.id,
            [0, 1, 2, 3, 4, 5, 6],
            false,
          );
        } else if (url.includes("/availability/")) {
          availabilityRequests += 1;
          if (availabilityRequests > 1) {
            await new Promise<void>((resolve) => {
              releaseNextAvailability = resolve;
            });
          }
          body = { bookings: [] };
        }
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as Response;
      }),
    );
    renderResourcesPage();

    const monthRegion = await screen.findByRole("region", { name: /availability$/i });
    const initialMonth = monthRegion.getAttribute("aria-label");
    await screen.findByLabelText("Reserve date");
    const inMonthDate = screen
      .getAllByRole("button", { name: /availability for Timed Room/ })
      .find((button) => !button.className.includes("outside-month"));
    if (!inMonthDate) throw new Error("No date from the current month was rendered.");
    fireEvent.click(inMonthDate);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByRole("region", { name: /availability$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(availabilityRequests).toBe(2);
    });
    expect(screen.getByRole("region", { name: /availability$/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Updating availability…");
    expect(screen.getByRole("region", { name: /availability$/i }).getAttribute("aria-busy")).toBe("true");
    if (!releaseNextAvailability) {
      throw new Error("The next availability request was not held for this test.");
    }
    releaseNextAvailability();
    await waitFor(() => {
      expect(screen.queryByText("Updating availability…")).toBeNull();
      expect(
        screen.getByRole("region", { name: /availability$/i }).getAttribute("aria-label"),
      ).not.toBe(initialMonth);
    });
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("supports selecting a day within week view and switching calendar views", async () => {
    mockReservationApi([timedResource], {
      [timedResource.id]: createConstraints(
        timedResource.id,
        [0, 1, 2, 3, 4, 5, 6],
        false,
      ),
    });
    renderResourcesPage();

    await screen.findByLabelText("Reserve date");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const weekDatePicker = await screen.findByRole("group", {
      name: "Choose a day in this week",
    });
    const weekDates = within(weekDatePicker).getAllByRole("button");
    expect(weekDates).toHaveLength(7);
    const selectedDate = weekDates.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    const nextDate = weekDates.find((button) => button !== selectedDate);
    expect(selectedDate).toBeTruthy();
    expect(nextDate).toBeTruthy();
    if (!nextDate) throw new Error("No other day was present in the selected week.");

    fireEvent.click(nextDate);
    await waitFor(() => {
      expect(
        weekDates.filter((button) => button.getAttribute("aria-pressed") === "true"),
      ).toHaveLength(1);
      expect(nextDate.getAttribute("aria-pressed")).toBe("true");
    });
    expect(document.querySelectorAll(".timeline-day.current")).toHaveLength(1);

    const selectedDayHeading = document.querySelector(
      ".selected-day-heading p",
    )?.textContent;
    const currentWeekTitle = document.querySelector(
      ".calendar-period-title",
    )?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => {
      expect(document.querySelector(".calendar-period-title")?.textContent)
        .not.toBe(currentWeekTitle);
    });
    expect(document.querySelector(".selected-day-heading p")?.textContent)
      .not.toBe(selectedDayHeading);

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByRole("region", { name: "Day calendar timeline" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Choose a day in this week" })).toBeNull();
    const currentDayTitle = document.querySelector(
      ".selected-day-heading p",
    )?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => {
      expect(document.querySelector(".selected-day-heading p")?.textContent)
        .not.toBe(currentDayTitle);
    });

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByRole("region", { name: /availability$/i })).toBeTruthy();
    expect(screen.getByLabelText("Start Time")).toBeTruthy();
    expect(screen.getByLabelText("End Time")).toBeTruthy();
  });
});
