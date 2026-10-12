import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PageHeading } from "../../components/PageHeading";
import { apiUrl } from "../../api/apiUrl";

type Resource = {
  id: number;
  name: string;
  resource_type: string;
  description: string;
  location: string;
  is_active: boolean;
  default_start_time: string;
  default_end_time: string;
  created_at?: string;
  updated_at?: string;
};

type AvailabilityConstraint = {
  id: number;
  resource: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

type BookingPayload = {
  id: number;
  user: number;
  user_email: string;
  resource: number;
  resource_name: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  notes?: string;
};

type CalendarView = "month" | "week" | "day";
type SlotStatus = "available" | "booked" | "unavailable";
type DateAvailability =
  | "available"
  | "partially-available"
  | "fully-booked"
  | "unavailable";
type TimeRange = {
  date: string;
  resourceId: string;
  start: number;
  end: number;
};
type DragRange = TimeRange & {
  current: number;
};

const FIRST_HOUR = 8;
const LAST_HOUR = 18;
const SLOT_COUNT = LAST_HOUR - FIRST_HOUR;
const SLOT_STARTS = Array.from(
  { length: SLOT_COUNT },
  (_, index) => FIRST_HOUR + index,
);
const TIME_BOUNDARIES = Array.from(
  { length: SLOT_COUNT + 1 },
  (_, index) => FIRST_HOUR + index,
);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return fromDateKey(value).toLocaleDateString("en-US", options);
}

function formatHour(hour: number) {
  const date = new Date(2026, 0, 1, hour);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHourRange(start: number, end: number) {
  return `${formatHour(start)} – ${formatHour(end)}`;
}

function getResourceById(resourceId: number | string, resources: Resource[]) {
  return resources.find((resource) => String(resource.id) === String(resourceId)) ?? resources[0];
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) return 0;
  const [hoursText = "0", minutesText = "0"] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
}

function normalizeBackendAvailabilityWindow(resource: Resource | undefined) {
  return {
    startTime: parseTimeToMinutes(resource?.default_start_time ?? "09:00:00"),
    endTime: parseTimeToMinutes(resource?.default_end_time ?? "18:00:00"),
  };
}

function getSlotStatus(
  resource: Resource | undefined,
  dateKey: string,
  slotIndex: number,
  reservations: BookingPayload[] = [],
  constraints: AvailabilityConstraint[] = [],
): SlotStatus {
  if (!resource) return "unavailable";

  const availability = normalizeBackendAvailabilityWindow(resource);
  const slotStartMinutes = (FIRST_HOUR + slotIndex) * 60;
  const slotEndMinutes = slotStartMinutes + 60;

  if (
    !resource.is_active ||
    slotStartMinutes < availability.startTime ||
    slotEndMinutes > availability.endTime
  ) {
    return "unavailable";
  }

  if (constraints.length > 0) {
    const backendWeekday = (fromDateKey(dateKey).getDay() + 6) % 7;
    const dayWindows = constraints.filter(
      (constraint) =>
        constraint.day_of_week === backendWeekday && constraint.is_active,
    );
    const insideConfiguredWindow = dayWindows.some(
      (constraint) =>
        slotStartMinutes >= parseTimeToMinutes(constraint.start_time) &&
        slotEndMinutes <= parseTimeToMinutes(constraint.end_time),
    );
    if (!insideConfiguredWindow) return "unavailable";
  }

  const hasBooking = reservations.some((reservation) => {
    if (
      reservation.status === "CANCELLED" ||
      reservation.resource !== resource.id ||
      reservation.reservation_date !== dateKey
    ) {
      return false;
    }

    const reservationStartMinutes = parseTimeToMinutes(reservation.start_time);
    const reservationEndMinutes = parseTimeToMinutes(reservation.end_time);
    return (
      reservationStartMinutes < slotEndMinutes &&
      reservationEndMinutes > slotStartMinutes
    );
  });

  return hasBooking ? "booked" : "available";
}

function validateRange(
  resource: Resource | undefined,
  range: TimeRange,
  reservations: BookingPayload[] = [],
  constraints: AvailabilityConstraint[] = [],
) {
  if (!resource) {
    return "Select a valid resource before choosing a time range.";
  }

  if (range.end <= range.start) {
    return "Choose an end time after the start time.";
  }

  for (let slot = range.start; slot < range.end; slot += 1) {
    const status = getSlotStatus(resource, range.date, slot, reservations, constraints);
    if (status === "booked") {
      return `${formatHour(FIRST_HOUR + slot)} is already booked for ${resource.name}. Choose a continuous available range.`;
    }
    if (status === "unavailable") {
      return `${formatHour(FIRST_HOUR + slot)} is outside ${resource.name}'s configured availability. Choose a continuous available range.`;
    }
  }

  return "";
}

function getDateAvailability(
  resource: Resource | undefined,
  dateKey: string,
  reservations: BookingPayload[],
  constraints: AvailabilityConstraint[],
): DateAvailability {
  if (!resource) {
    return "unavailable";
  }

  const statuses = SLOT_STARTS.map((slot) =>
    getSlotStatus(resource, dateKey, slot - FIRST_HOUR, reservations, constraints),
  );
  const availableCount = statuses.filter(
    (status) => status === "available",
  ).length;
  const bookedCount = statuses.filter((status) => status === "booked").length;
  if (availableCount > 0 && bookedCount > 0) return "partially-available";
  if (availableCount > 0) return "available";
  if (statuses.includes("booked")) return "fully-booked";
  return "unavailable";
}

function getWeekDates(selectedDate: Date) {
  const sunday = addDays(selectedDate, -selectedDate.getDay());
  return Array.from({ length: 7 }, (_, index) =>
    toDateKey(addDays(sunday, index)),
  );
}

function getMonthDates(selectedDate: Date) {
  const monthStart = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    1,
    12,
  );
  const firstVisible = addDays(monthStart, -monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) =>
    toDateKey(addDays(firstVisible, index)),
  );
}

function getCsrfToken() {
  const csrfCookie = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("csrftoken="));

  return csrfCookie
    ? decodeURIComponent(csrfCookie.slice("csrftoken=".length))
    : null;
}

export function ResourcesPage() {
  const { user } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [reservations, setReservations] = useState<BookingPayload[]>([]);
  const [constraintsByResource, setConstraintsByResource] = useState<
    Record<number, AvailabilityConstraint[]>
  >({});
  const [resourceId, setResourceId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(() =>
    toDateKey(new Date()),
  );
  const [view, setView] = useState<CalendarView>("month");
  const [selectedRange, setSelectedRange] = useState<TimeRange | null>(null);
  const [draftRange, setDraftRange] = useState<TimeRange | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [selectionHint, setSelectionHint] = useState("");
  const [notice, setNotice] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [isLoading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [loadError, setError] = useState("");
  const dragRef = useRef<DragRange | null>(null);
  const ignoreClickRef = useRef(false);

  const resource = resourceId ? getResourceById(resourceId, resources) : undefined;
  const selectedDateObject = fromDateKey(selectedDate);
  const monthDates = useMemo(
    () => getMonthDates(selectedDateObject),
    [selectedDateObject.getFullYear(), selectedDateObject.getMonth()],
  );
  const weekDates = useMemo(
    () => getWeekDates(selectedDateObject),
    [selectedDate],
  );
  const availabilityDates =
    view === "month"
      ? [monthDates[0], monthDates[monthDates.length - 1]]
      : view === "week"
        ? [weekDates[0], weekDates[weekDates.length - 1]]
        : [selectedDate, selectedDate];
  const visibleDates =
    view === "day" ? [selectedDate] : view === "week" ? weekDates : [selectedDate];

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function loadResources() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(apiUrl("/resources/"), {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error("Could not load resources from the server.");
        }

        const payload = (await response.json()) as Resource[];
        const activeResources = (Array.isArray(payload) ? payload : []).filter(
          (item) => item.is_active,
        );
        if (!active) return;
        setResources(activeResources);
        setResourceId((currentId) =>
          activeResources.some((item) => String(item.id) === currentId)
            ? currentId
            : String(activeResources[0]?.id ?? ""),
        );
      } catch (resourceError) {
        if (!active) return;
        setError(
          resourceError instanceof Error
            ? resourceError.message
            : "Could not load resource information from the server.",
        );
        setResources([]);
        setReservations([]);
        setConstraintsByResource({});
        setResourceId("");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadResources();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !resource) {
      setReservations([]);
      setAvailabilityLoading(false);
      return;
    }

    const selectedResource = resource;
    let active = true;
    const [startDate, endDate] = availabilityDates;
    const dateQuery = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    async function loadSelectedResourceAvailability() {
      setAvailabilityLoading(true);
      setError("");

      try {
        const [constraintsResponse, availabilityResponse] = await Promise.all([
          fetch(apiUrl(`/resources/${selectedResource.id}/constraints/`), {
            credentials: "include",
          }),
          fetch(
            apiUrl(
              `/resources/${selectedResource.id}/availability/?${dateQuery.toString()}`,
            ),
            { credentials: "include" },
          ),
        ]);

        if (!constraintsResponse.ok) {
          throw new Error(
            `Could not load availability rules for ${selectedResource.name}.`,
          );
        }
        if (!availabilityResponse.ok) {
          throw new Error(`Could not load reservations for ${selectedResource.name}.`);
        }

        const [constraints, availability] = await Promise.all([
          constraintsResponse.json() as Promise<AvailabilityConstraint[]>,
          availabilityResponse.json() as Promise<{
            bookings: Array<{
              date: string;
              start_time: string;
              end_time: string;
              status: "CONFIRMED" | "PENDING" | "CANCELLED";
            }>;
          }>,
        ]);
        if (!active) return;

        setConstraintsByResource((current) => ({
          ...current,
          [selectedResource.id]: constraints,
        }));
        setReservations(
          availability.bookings.map((booking) => ({
            id: 0,
            user: 0,
            user_email: "",
            resource: selectedResource.id,
            resource_name: selectedResource.name,
            reservation_date: booking.date,
            start_time: booking.start_time,
            end_time: booking.end_time,
            status: booking.status,
          })),
        );
      } catch (availabilityError) {
        if (!active) return;
        setError(
          availabilityError instanceof Error
            ? availabilityError.message
            : `Could not load availability for ${selectedResource.name}.`,
        );
        setReservations([]);
        setConstraintsByResource((current) => ({
          ...current,
          [selectedResource.id]: [],
        }));
      } finally {
        if (active) setAvailabilityLoading(false);
      }
    }

    void loadSelectedResourceAvailability();
    return () => {
      active = false;
    };
  }, [
    user?.id,
    resource?.id,
    resource?.name,
    availabilityDates[0],
    availabilityDates[1],
    availabilityRevision,
  ]);

  function clearSelection() {
    setSelectedRange(null);
    setDraftRange(null);
    setSelectionError("");
    setSelectionHint("");
    setNotice("");
    dragRef.current = null;
  }

  function changeDate(date: string) {
    setSelectedDate(date);
    clearSelection();
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag || !resource) return;
    dragRef.current = null;
    ignoreClickRef.current = true;

    const range: TimeRange = {
      date: drag.date,
      resourceId: drag.resourceId,
      start: Math.min(drag.start, drag.current),
      end:
        drag.current === drag.start
          ? drag.start + 1
          : Math.max(drag.start, drag.current),
    };
    setDraftRange(null);
    setSelectedRange(range);
    setSelectionError(
      validateRange(resource, range, reservations, constraintsByResource[resource.id] ?? []),
    );
    setStartTime(`${String(FIRST_HOUR + range.start).padStart(2, "0")}:00`);
    setEndTime(`${String(FIRST_HOUR + range.end).padStart(2, "0")}:00`);
    setNotice("");
  }

  useEffect(() => {
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [resource, reservations]);

  function navigateCalendar(direction: -1 | 1) {
    const date = fromDateKey(selectedDate);
    if (view === "month") {
      const dayOfMonth = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() + direction);
      const lastDayOfMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
      ).getDate();
      date.setDate(Math.min(dayOfMonth, lastDayOfMonth));
    } else if (view === "week") {
      date.setDate(date.getDate() + direction * 7);
    } else {
      date.setDate(date.getDate() + direction);
    }
    changeDate(toDateKey(date));
  }

  function changeResource(nextResourceId: string) {
    setResourceId(nextResourceId);
    clearSelection();
  }

  function getCellStatus(date: string, slotIndex: number): SlotStatus {
    if (!resource) return "unavailable";
    return getSlotStatus(
      resource,
      date,
      slotIndex,
      reservations,
      constraintsByResource[resource.id] ?? [],
    );
  }

  function isInRange(date: string, slotIndex: number) {
    const range = draftRange ?? selectedRange;
    return Boolean(
      range &&
        range.resourceId === resourceId &&
        range.date === date &&
        slotIndex >= range.start &&
        slotIndex < range.end,
    );
  }

  function selectRangeFromControls() {
    if (!resource) return;
    const start = Number(startTime.slice(0, 2)) - FIRST_HOUR;
    const end = Number(endTime.slice(0, 2)) - FIRST_HOUR;
    const range: TimeRange = {
      date: selectedDate,
      resourceId,
      start,
      end,
    };
    setSelectedRange(range);
    setDraftRange(null);
    setSelectionError(
      validateRange(resource, range, reservations, constraintsByResource[resource.id] ?? []),
    );
    setSelectionHint("");
    setNotice("");
  }

  async function reserveSelectedRange() {
    if (!selectedRange || selectionError || !resource) return;

    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      setSelectionError("The session security token is unavailable. Please refresh the page and try again.");
      return;
    }

    try {
      const response = await fetch(apiUrl("/reservations/"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
        },
        body: JSON.stringify({
          resource: Number(resource.id),
          reservation_date: selectedRange.date,
          start_time: `${String(FIRST_HOUR + selectedRange.start).padStart(2, "0")}:00`,
          end_time: `${String(FIRST_HOUR + selectedRange.end).padStart(2, "0")}:00`,
          notes: "Created from the resources calendar.",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        detail?: string;
        non_field_errors?: string[];
        end_time?: string[];
        resource?: string[];
        status?: BookingPayload["status"];
      };

      if (!response.ok) {
        const backendMessage =
          payload.detail ||
          payload.non_field_errors?.[0] ||
          payload.end_time?.[0] ||
          payload.resource?.[0] ||
          "The reservation could not be created.";
        throw new Error(backendMessage);
      }

      setAvailabilityRevision((current) => current + 1);
      setNotice(
        `${resource.name} is reserved for ${formatDate(selectedRange.date, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}, ${formatHourRange(
          FIRST_HOUR + selectedRange.start,
          FIRST_HOUR + selectedRange.end,
        )} (${payload.status?.toLowerCase() ?? "confirmed"}).`,
      );
      setSelectedRange(null);
      setDraftRange(null);
      setSelectionError("");
    } catch (bookingError) {
      const message =
        bookingError instanceof Error
          ? bookingError.message
          : "The reservation could not be created.";
      setSelectionError(message);
    }
  }

  function startDrag(date: string, slotIndex: number) {
    if (!resource) return;
    ignoreClickRef.current = true;
    setNotice("");
    setSelectionError("");
    setSelectionHint("");
    setSelectedDate(date);
    setSelectedRange(null);
    const status = getCellStatus(date, slotIndex);
    if (status !== "available") {
      dragRef.current = null;
      setDraftRange(null);
      setSelectionError(
        status === "booked"
          ? "That period is already booked."
          : `${resource.name} is not available during that period.`,
      );
      return;
    }

    dragRef.current = {
      resourceId,
      date,
      start: slotIndex,
      current: slotIndex,
      end: slotIndex + 1,
    };
    setDraftRange({
      resourceId,
      date,
      start: slotIndex,
      end: slotIndex + 1,
    });
  }

  function updateDrag(date: string, slotIndex: number) {
    const drag = dragRef.current;
    if (!drag || !resource) return;
    if (date !== drag.date) {
      setSelectionHint("A reservation range must stay within one date.");
      return;
    }

    let acceptedCurrent = drag.start;
    const direction = Math.sign(slotIndex - drag.start);
    let blockedStatus: SlotStatus | null = null;
    let blockedIndex: number | null = null;

    if (direction > 0) {
      for (
        let candidate = drag.start + direction;
        candidate < slotIndex;
        candidate += 1
      ) {
        const status = getCellStatus(date, candidate);
        if (status !== "available") {
          blockedStatus = status;
          blockedIndex = candidate;
          break;
        }
        acceptedCurrent = candidate;
      }
      if (!blockedStatus) acceptedCurrent = slotIndex;
    } else if (direction < 0) {
      for (
        let candidate = drag.start - 1;
        candidate >= slotIndex;
        candidate -= 1
      ) {
        const status = getCellStatus(date, candidate);
        if (status !== "available") {
          blockedStatus = status;
          blockedIndex = candidate;
          acceptedCurrent = candidate + 1;
          break;
        }
        acceptedCurrent = candidate;
      }
    }

    drag.current = acceptedCurrent;
    const rangeStart = Math.min(drag.start, acceptedCurrent);
    const rangeEnd =
      rangeStart === Math.max(drag.start, acceptedCurrent)
        ? drag.start + 1
        : Math.max(drag.start, acceptedCurrent);
    const range: TimeRange = {
      resourceId: drag.resourceId,
      date: drag.date,
      start: rangeStart,
      end: rangeEnd,
    };
    setDraftRange(range);
    if (blockedStatus && blockedIndex !== null) {
      const blockedTime = formatHour(FIRST_HOUR + blockedIndex);
      setSelectionHint(
        blockedStatus === "booked"
          ? `Selection stopped before ${blockedTime}; that period is booked.`
          : `Selection stopped before ${blockedTime}; the resource is unavailable.`,
      );
    } else {
      setSelectionHint("");
    }
  }

  function handleSlotClick(date: string, slotIndex: number, detail: number) {
    if (!resource) return;
    if (detail > 0 && ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (detail > 0) return;

    setSelectedDate(date);
    setNotice("");
    setSelectionHint("");
    const status = getCellStatus(date, slotIndex);
    if (status !== "available") {
      setSelectionError(
        status === "booked"
          ? "That period is already booked."
          : `${resource.name} is not available during that period.`,
      );
      return;
    }
    const range: TimeRange = {
      date,
      resourceId,
      start: slotIndex,
      end: slotIndex + 1,
    };
    setSelectedRange(range);
    setSelectionError("");
    setStartTime(`${String(FIRST_HOUR + slotIndex).padStart(2, "0")}:00`);
    setEndTime(`${String(FIRST_HOUR + slotIndex + 1).padStart(2, "0")}:00`);
  }

  function renderTimeGrid(dates: string[]) {
    return (
      <div
        className="calendar-grid-scroll"
        role="region"
        aria-label={dates.length === 1 ? "Day calendar time slots" : "Week calendar time slots"}
        tabIndex={0}
      >
        <div
          className={`calendar-time-grid ${dates.length === 1 ? "calendar-time-grid-day" : "calendar-time-grid-week"}`}
          style={{ "--calendar-day-count": dates.length } as CSSProperties}
        >
        <div className="time-grid-header time-grid-time-label">TIME</div>
        {dates.map((date) => (
          <button
            className={`time-grid-header time-grid-day-header ${date === selectedDate ? "current" : ""}`}
            key={date}
            type="button"
            onClick={() => {
              changeDate(date);
              setView("day");
            }}
          >
            <span>{formatDate(date, { weekday: "short" })}</span>
            <strong>{formatDate(date, { day: "numeric" })}</strong>
          </button>
        ))}

        {SLOT_STARTS.map((hour) => {
          const slotIndex = hour - FIRST_HOUR;
          return (
            <div className="time-grid-row" key={hour}>
              <div className="time-grid-hour">{formatHour(hour)}</div>
              {dates.map((date) => {
                const status = getCellStatus(date, slotIndex);
                const inRange = isInRange(date, slotIndex);
                const error =
                  (draftRange ?? selectedRange) &&
                  selectionError &&
                  inRange;
                return (
                  <button
                    aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}, ${formatHourRange(hour, hour + 1)}, ${status}${inRange ? ", selected range" : ""}`}
                    aria-disabled={status !== "available"}
                    aria-pressed={inRange}
                    className={[
                      "calendar-slot",
                      `calendar-slot-${status}`,
                      inRange ? "calendar-slot-selected" : "",
                      error ? "calendar-slot-invalid" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={date}
                    type="button"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      startDrag(date, slotIndex);
                    }}
                    onPointerMove={() => updateDrag(date, slotIndex)}
                    onPointerEnter={() => updateDrag(date, slotIndex)}
                    onClick={(event) =>
                      handleSlotClick(date, slotIndex, event.detail)
                    }
                  >
                    {status === "booked" && (
                      <span className="calendar-slot-label">Booked</span>
                    )}
                    {status === "unavailable" && (
                      <span className="calendar-slot-label">Unavailable</span>
                    )}
                    {inRange && !error && (
                      <span className="calendar-slot-label">Selected</span>
                    )}
                    {inRange && error && (
                      <span className="calendar-slot-label">Unavailable</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
        </div>
      </div>
    );
  }

  const rangeForSummary = draftRange ?? selectedRange;
  const rangeValidation = rangeForSummary
    ? validateRange(
        resource,
        rangeForSummary,
        reservations,
        resource ? constraintsByResource[resource.id] ?? [] : [],
      )
    : selectionError;
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const monthTitle = selectedDateObject.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="content-stack reservation-calendar-page">
      <PageHeading
        title="Make a reservation"
        description="Browse resource availability and select a continuous time range."
      />

      <section className="panel calendar-panel">
        {loadError && (
          <div className="inline-notice inline-notice-error" role="alert">
            {loadError}
          </div>
        )}

        <div className="calendar-toolbar">
          <label className="form-control calendar-resource-select">
            <span>Resource</span>
            <select
              value={resourceId}
              onChange={(event) => changeResource(event.target.value)}
              disabled={resources.length === 0}
            >
              {resources.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name} · {item.resource_type}
                </option>
              ))}
            </select>
          </label>

          <div className="calendar-date-navigation">
            <div className="calendar-step-buttons">
              <button
                className="icon-button"
                type="button"
                aria-label="Previous"
                onClick={() => navigateCalendar(-1)}
              >
                ‹
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Next"
                onClick={() => navigateCalendar(1)}
              >
                ›
              </button>
            </div>
            <button
              className="button button-secondary calendar-today-button"
              type="button"
              onClick={() => changeDate(toDateKey(new Date()))}
            >
              Today
            </button>
            <h2 className="calendar-period-title">
              {view === "month"
                ? monthTitle
                : view === "week"
                  ? `${formatDate(weekStart, { month: "short", day: "numeric" })} – ${formatDate(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`
                  : formatDate(selectedDate, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
            </h2>
          </div>

          <div className="calendar-view-switch" role="group" aria-label="Calendar view">
            {(["month", "week", "day"] as const).map((option) => (
              <button
                aria-pressed={view === option}
                className={view === option ? "active" : ""}
                key={option}
                type="button"
                onClick={() => {
                  setView(option);
                  clearSelection();
                }}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading || availabilityLoading ? (
          <div className="inline-notice" role="status">
            {isLoading
              ? "Loading resources…"
              : `Loading availability for ${resource?.name ?? "the selected resource"}…`}
          </div>
        ) : resources.length === 0 ? (
          <div className="inline-notice inline-notice-error" role="alert">
            No active resources are currently available.
          </div>
        ) : view === "month" ? (
          <div className="month-calendar" aria-label={`${monthTitle} availability`}>
            <div className="month-weekday-row">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="month-date-grid">
              {monthDates.map((date) => {
                const dateObject = fromDateKey(date);
                const inCurrentMonth =
                  dateObject.getMonth() === selectedDateObject.getMonth();
                const availability = getDateAvailability(
                  resource,
                  date,
                  reservations,
                  resource ? constraintsByResource[resource.id] ?? [] : [],
                );
                return (
                  <button
                    aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}: ${availability} availability for ${resource?.name ?? "resource"}`}
                    aria-pressed={date === selectedDate}
                    className={[
                      "month-date-cell",
                      inCurrentMonth ? "" : "outside-month",
                      date === selectedDate ? "selected-date" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={date}
                    type="button"
                    onClick={() => {
                      changeDate(date);
                      setView("day");
                    }}
                  >
                    <span className="month-date-number">
                      {dateObject.getDate()}
                    </span>
                    <span className={`date-availability date-${availability}`}>
                      <i aria-hidden="true" />
                      {availability === "available"
                        ? "Available"
                        : availability === "partially-available"
                          ? "Partially available"
                        : availability === "fully-booked"
                          ? "Fully booked"
                          : "Unavailable"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          renderTimeGrid(visibleDates)
        )}

        <div className="calendar-legend" aria-label="Availability legend">
          <span><i className="legend-dot legend-available" />Available</span>
          <span><i className="legend-dot legend-reserved" />Booked</span>
          <span><i className="legend-dot legend-unavailable" />Unavailable</span>
          <span><i className="legend-dot legend-selected" />Selected range</span>
        </div>
      </section>

      <section className="panel selected-day-panel">
        <div className="selected-day-heading">
          <div>
            <h2>{resource?.name ?? "Resource"} schedule</h2>
            <p>
              {resource?.location ?? "Location unavailable"} ·{" "}
              {formatDate(selectedDate, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <span className="resource-type-pill">{resource?.resource_type ?? "Resource"}</span>
        </div>
        {view === "month" && renderTimeGrid([selectedDate])}
        <div className="range-selection-tools">
          <div className="range-helper">
            <strong>Select a continuous time range</strong>
            <span>Drag across available periods, or choose start and end times.</span>
          </div>
          <div className="range-controls">
            <label className="form-control">
              <span>Start time</span>
              <select
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              >
                {TIME_BOUNDARIES.slice(0, -1).map((hour) => {
                  const value = `${String(hour).padStart(2, "0")}:00`;
                  return (
                    <option key={value} value={value}>
                      {formatHour(hour)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="form-control">
              <span>End time</span>
              <select
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              >
                {TIME_BOUNDARIES.slice(1).map((hour) => {
                  const value = `${String(hour).padStart(2, "0")}:00`;
                  return (
                    <option key={value} value={value}>
                      {formatHour(hour)}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              className="button button-secondary apply-range-button"
              type="button"
              onClick={selectRangeFromControls}
            >
              Apply range
            </button>
          </div>
        </div>

        <div className="reservation-summary">
          <div className="reservation-summary-details">
            <div className="reservation-summary-title">
              <span className="summary-label">Reservation Summary</span>
              {rangeForSummary && (
                <strong>
                  {formatHourRange(
                    FIRST_HOUR + rangeForSummary.start,
                    FIRST_HOUR + rangeForSummary.end,
                  )}
                </strong>
              )}
            </div>
            {rangeForSummary ? (
              <dl className="reservation-summary-fields">
                <div>
                  <dt>Resource</dt>
                  <dd>{resource?.name ?? "Resource"}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>
                    {formatDate(rangeForSummary.date, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Start</dt>
                  <dd>{formatHour(FIRST_HOUR + rangeForSummary.start)}</dd>
                </div>
                <div>
                  <dt>End</dt>
                  <dd>{formatHour(FIRST_HOUR + rangeForSummary.end)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {rangeForSummary.end - rangeForSummary.start}{" "}
                    {rangeForSummary.end - rangeForSummary.start === 1
                      ? "hour"
                      : "hours"}
                  </dd>
                </div>
              </dl>
            ) : (
              <small>Select an available period on the calendar.</small>
            )}
          </div>
          <div className="summary-actions">
            {rangeForSummary && (
              <button
                className="table-action"
                type="button"
                onClick={clearSelection}
              >
                Cancel
              </button>
            )}
            <button
              className="button button-primary"
              type="button"
              disabled={!selectedRange || Boolean(rangeValidation)}
              onClick={reserveSelectedRange}
            >
              Reserve
            </button>
          </div>
        </div>
        {selectionHint && (
          <p className="calendar-selection-hint" role="status">
            {selectionHint}
          </p>
        )}
        {rangeValidation && (
          <p className="inline-notice inline-notice-error" role="alert">
            {rangeValidation}
          </p>
        )}
        {notice && (
          <div className="inline-notice" role="status">
            <span>{notice}</span>{" "}
            <Link to="/my-reservations">View My Reservations</Link>
          </div>
        )}
      </section>
    </div>
  );
}
