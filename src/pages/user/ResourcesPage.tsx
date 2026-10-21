import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PageHeading } from "../../components/PageHeading";
import { apiUrl } from "../../api/apiUrl";
import { requireCsrfToken } from "../../api/csrf";
import { cachedGet, invalidateCachedGets } from "../../api/requestCache";

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
  is_full_day: boolean;
  is_active: boolean;
};

type BookingPayload = {
  id: number;
  user: number;
  user_email: string;
  resource: number;
  resource_name: string;
  reservation_date: string;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
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
  startDate?: string;
  endDate?: string;
  resourceId: string;
  start: number;
  end: number;
  isFullDay?: boolean;
};
type DragRange = {
  date: string;
  resourceId: string;
  startMinute: number;
  currentMinute: number;
};

const SLOT_MINUTES = 15;
const HOUR_HEIGHT_PX = 64;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SELECTED_RESOURCE_STORAGE_KEY = "resource-reservation.selected-resource";
const RESERVATION_TIME_ZONE = "UTC";

function getReservationClock() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: RESERVATION_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(Date.now()))
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

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

function getDateKeysInRange(startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) return [];
  const firstDay = fromDateKey(startDate);
  const lastDay = fromDateKey(endDate);
  if (Number.isNaN(firstDay.getTime()) || Number.isNaN(lastDay.getTime())) return [];
  const dates: string[] = [];
  for (let current = firstDay; current <= lastDay; current = addDays(current, 1)) {
    dates.push(toDateKey(current));
  }
  return dates;
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return fromDateKey(value).toLocaleDateString("en-US", options);
}

function formatTime(minutes: number) {
  const date = new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(start: number, end: number) {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function toTimeInputValue(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours && remainingMinutes) return `${hours} hr ${remainingMinutes} min`;
  if (hours) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${remainingMinutes} minutes`;
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

function getAvailabilityWindows(
  resource: Resource | undefined,
  dateKey: string,
  constraints: AvailabilityConstraint[],
) {
  if (!resource?.is_active) return [];
  if (constraints.length === 0) {
    const defaultWindow = normalizeBackendAvailabilityWindow(resource);
    const fullDay =
      defaultWindow.startTime === 0 && defaultWindow.endTime === 23 * 60 + 59;
    return [{
      start: defaultWindow.startTime,
      end: fullDay ? 24 * 60 : defaultWindow.endTime,
      isFullDay: fullDay,
    }];
  }

  const backendWeekday = (fromDateKey(dateKey).getDay() + 6) % 7;
  return constraints
    .filter(
      (constraint) =>
        constraint.day_of_week === backendWeekday && constraint.is_active,
    )
    .map((constraint) => ({
      start: parseTimeToMinutes(constraint.start_time),
      end: constraint.is_full_day
        ? 24 * 60
        : parseTimeToMinutes(constraint.end_time),
      isFullDay: constraint.is_full_day,
    }))
    .filter((window) => window.end > window.start)
    .sort((first, second) => first.start - second.start);
}

function getTimeOptions(
  windows: Array<{ start: number; end: number }>,
  includeWindowEnd: boolean,
) {
  const minutes = new Set<number>();
  windows.forEach((window) => {
    for (let minute = window.start; minute < window.end; minute += SLOT_MINUTES) {
      minutes.add(minute);
    }
    if (includeWindowEnd) {
      minutes.add(Math.min(window.end, 23 * 60 + 59));
    }
  });
  return Array.from(minutes)
    .sort((first, second) => first - second)
    .map(toTimeInputValue);
}

function getEndTimeOptions(
  windows: Array<{ start: number; end: number }>,
  startTime: string,
  isSameDay: boolean,
) {
  const startMinutes = parseTimeToMinutes(startTime);
  const eligibleWindows = isSameDay
    ? windows.filter(
        (window) =>
          startMinutes >= window.start && startMinutes < window.end,
      )
    : windows;
  return getTimeOptions(eligibleWindows, true).filter(
    (time) => !isSameDay || parseTimeToMinutes(time) > startMinutes,
  );
}

function getSlotStatus(
  resource: Resource | undefined,
  dateKey: string,
  slotStartMinutes: number,
  reservations: BookingPayload[] = [],
  constraints: AvailabilityConstraint[] = [],
): SlotStatus {
  if (!resource) return "unavailable";

  const slotEndMinutes = slotStartMinutes + SLOT_MINUTES;
  const dayWindows = getAvailabilityWindows(resource, dateKey, constraints);
  if (
    !dayWindows.some(
      (window) =>
        slotStartMinutes >= window.start && slotEndMinutes <= window.end,
    )
  ) {
    return "unavailable";
  }

  const hasBooking = reservations.some((reservation) => {
    if (
      reservation.status === "CANCELLED" ||
      reservation.resource !== resource.id ||
      reservation.reservation_date !== dateKey
    ) {
      return false;
    }

    if (reservation.is_full_day) return true;
    const reservationStartMinutes = parseTimeToMinutes(reservation.start_time);
    const reservationEndMinutes = parseTimeToMinutes(reservation.end_time);
    return (
      reservationStartMinutes < slotEndMinutes &&
      reservationEndMinutes > slotStartMinutes
    );
  });

  return hasBooking ? "booked" : "available";
}

function isFullDayAvailable(
  resource: Resource | undefined,
  dateKey: string,
  constraints: AvailabilityConstraint[],
) {
  if (!resource?.is_active) return false;
  const windows = getAvailabilityWindows(resource, dateKey, constraints);
  return windows.some((window) => window.isFullDay);
}

function getWeekdayFullDayAvailability(
  resource: Resource,
  constraints: AvailabilityConstraint[],
) {
  const monday = new Date(2024, 0, 1, 12);
  return Array.from({ length: 7 }, (_, weekday) =>
    getAvailabilityWindows(
      resource,
      toDateKey(addDays(monday, weekday)),
      constraints,
    ).some((window) => window.isFullDay),
  );
}

function hasResourceAvailability(
  resource: Resource,
  constraints: AvailabilityConstraint[],
) {
  const monday = new Date(2024, 0, 1, 12);
  return Array.from({ length: 7 }, (_, weekday) =>
    getAvailabilityWindows(
      resource,
      toDateKey(addDays(monday, weekday)),
      constraints,
    ).length > 0,
  ).some(Boolean);
}

function supportsMultiDayReservations(
  resource: Resource,
  constraints: AvailabilityConstraint[],
) {
  const fullDayByWeekday = getWeekdayFullDayAvailability(resource, constraints);
  return fullDayByWeekday.some(
    (available, weekday) =>
      available && fullDayByWeekday[(weekday + 1) % fullDayByWeekday.length],
  );
}

function isFullDayOnlyResource(
  resource: Resource,
  constraints: AvailabilityConstraint[],
) {
  const monday = new Date(2024, 0, 1, 12);
  const windowsByWeekday = Array.from({ length: 7 }, (_, weekday) =>
    getAvailabilityWindows(
      resource,
      toDateKey(addDays(monday, weekday)),
      constraints,
    ),
  );
  const activeWindows = windowsByWeekday.flat();
  return activeWindows.length > 0 &&
    activeWindows.every((window) => window.isFullDay);
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

  const startDate = range.startDate ?? range.date;
  const endDate = range.endDate ?? range.date;
  if (!startDate || !endDate) {
    return "Choose a valid start and end date.";
  }
  if (endDate < startDate) {
    return "Choose an end date on or after the start date.";
  }
  const reservationClock = getReservationClock();
  if (startDate < reservationClock.date) {
    return "Reservations cannot be made for past dates.";
  }
  if (startDate === reservationClock.date) {
    if (range.isFullDay) {
      return "Full-day reservations must start on a future date.";
    }
    if (range.start <= reservationClock.minutes) {
      return "Reservations for today must start at a future time.";
    }
  }

  if (!resource.is_active) {
    return `${resource.name} is not available for reservations.`;
  }

  const datesInRange = getDateKeysInRange(startDate, endDate);

  if (range.isFullDay) {
    for (const dateKey of datesInRange) {
      if (!isFullDayAvailable(resource, dateKey, constraints)) {
        return `${resource.name} is not configured for full-day reservations on every selected date.`;
      }
      if (
        reservations.some(
          (reservation) =>
            reservation.status !== "CANCELLED" &&
            reservation.resource === resource.id &&
            reservation.reservation_date === dateKey,
        )
      ) {
        return `The selected date overlaps an existing reservation for ${resource.name}.`;
      }
    }
    return "";
  }

  if (startDate === endDate && range.end <= range.start) {
    return "Choose an end time after the start time.";
  }

  for (const dateKey of datesInRange) {
    const dayWindows = getAvailabilityWindows(resource, dateKey, constraints);
    const firstDay = dateKey === startDate;
    const lastDay = dateKey === endDate;
    const dayStart = firstDay ? range.start : 0;
    const dayEnd = lastDay ? range.end : 24 * 60;
    if (
      !dayWindows.some(
        (window) => dayStart >= window.start && dayEnd <= window.end,
      )
    ) {
      return `${resource.name} is not available for the full selected time range.`;
    }

    const hasConflict = reservations.some((reservation) => {
      if (
        reservation.status === "CANCELLED" ||
        reservation.resource !== resource.id ||
        reservation.reservation_date !== dateKey
      ) {
        return false;
      }

      if (reservation.is_full_day) return true;
      return (
        dayStart < parseTimeToMinutes(reservation.end_time) &&
        dayEnd > parseTimeToMinutes(reservation.start_time)
      );
    });
    if (hasConflict) {
      return `The selected time overlaps an existing reservation for ${resource.name}.`;
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

  const defaultWindow = normalizeBackendAvailabilityWindow(resource);
  const dayWindows = getAvailabilityWindows(resource, dateKey, constraints);
  const start = dayWindows.length
    ? Math.min(...dayWindows.map((window) => window.start))
    : defaultWindow.startTime;
  const end = dayWindows.length
    ? Math.max(...dayWindows.map((window) => window.end))
    : defaultWindow.endTime;
  const statuses = Array.from(
    { length: Math.max(0, Math.ceil((end - start) / SLOT_MINUTES)) },
    (_, index) =>
      getSlotStatus(
        resource,
        dateKey,
        start + index * SLOT_MINUTES,
        reservations,
        constraints,
      ),
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

type ReservationDatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function ReservationDatePicker({
  label,
  value,
  onChange,
}: ReservationDatePickerProps) {
  const pickerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedDate = fromDateKey(value);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12),
  );
  const [popoverPosition, setPopoverPosition] = useState({
    top: 0,
    left: 0,
    visibility: "hidden" as "hidden" | "visible",
  });
  const monthDates = useMemo(
    () => getMonthDates(visibleMonth),
    [visibleMonth.getFullYear(), visibleMonth.getMonth()],
  );

  useEffect(() => {
    if (!isOpen) return;

    function updatePopoverPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(304, viewportWidth - 16);
      const popupHeight =
        popoverRef.current?.getBoundingClientRect().height ?? 292;
      const left = Math.max(
        8,
        Math.min(bounds.left, viewportWidth - width - 8),
      );
      const maxTop = Math.max(8, viewportHeight - popupHeight - 8);
      const top =
        bounds.bottom + popupHeight + 4 <= viewportHeight - 8
          ? Math.min(bounds.bottom + 4, maxTop)
          : Math.max(8, Math.min(bounds.top - popupHeight - 4, maxTop));
      setPopoverPosition({ top, left, visibility: "visible" });
    }

    function dismissOnOutsidePointer(event: globalThis.PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    updatePopoverPosition();
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen]);

  function moveMonth(direction: -1 | 1) {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + direction, 1, 12),
    );
  }

  function selectDate(date: string) {
    onChange(date);
    setVisibleMonth(fromDateKey(date));
    setIsOpen(false);
  }

  return (
    <>
      <button
        aria-controls={pickerId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={label}
        className="reservation-date-picker-trigger"
        onClick={() => {
          if (!isOpen) setVisibleMonth(fromDateKey(value));
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{formatDate(value, { month: "short", day: "numeric", year: "numeric" })}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <rect x="2.25" y="3.5" width="11.5" height="10" rx="1.5" />
          <path d="M5 2.5v2M11 2.5v2M2.5 6.5h11" />
        </svg>
      </button>
      {isOpen &&
        createPortal(
          <div
            aria-label={`Choose ${label} date`}
            className="reservation-date-picker-popover"
            id={pickerId}
            ref={popoverRef}
            role="dialog"
            data-visible-month={`${visibleMonth.getFullYear()}-${String(
              visibleMonth.getMonth() + 1,
            ).padStart(2, "0")}`}
            style={{
              top: popoverPosition.top,
              left: popoverPosition.left,
              visibility: popoverPosition.visibility,
            }}
          >
            <div className="reservation-date-picker-header">
              <button
                aria-label="Previous month"
                className="reservation-date-picker-nav"
                onClick={() => moveMonth(-1)}
                type="button"
              >
                ‹
              </button>
              <strong>
                {visibleMonth.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                aria-label="Next month"
                className="reservation-date-picker-nav"
                onClick={() => moveMonth(1)}
                type="button"
              >
                ›
              </button>
            </div>
            <div aria-hidden="true" className="reservation-date-picker-weekdays">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday}>{weekday.slice(0, 1)}</span>
              ))}
            </div>
            <div className="reservation-date-picker-days">
              {monthDates.map((date) => {
                const dateObject = fromDateKey(date);
                const isCurrentMonth =
                  dateObject.getMonth() === visibleMonth.getMonth();
                return (
                  <button
                    aria-label={formatDate(date, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                    aria-pressed={date === value}
                    className={[
                      "reservation-date-picker-day",
                      isCurrentMonth ? "" : "outside-month",
                      date === value ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-date={date}
                    key={date}
                    onClick={() => selectDate(date)}
                    type="button"
                  >
                    {dateObject.getDate()}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
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
    getReservationClock().date,
  );
  const [startDate, setStartDate] = useState(() => getReservationClock().date);
  const [endDate, setEndDate] = useState(() => getReservationClock().date);
  const [isFullDaySelected, setIsFullDaySelected] = useState(false);
  const [view, setView] = useState<CalendarView>("month");
  const [selectedRange, setSelectedRange] = useState<TimeRange | null>(null);
  const [draftRange, setDraftRange] = useState<TimeRange | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [selectionHint, setSelectionHint] = useState("");
  const [notice, setNotice] = useState("");
  const [isReserving, setIsReserving] = useState(false);
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
  const resourceConstraints = resource
    ? constraintsByResource[resource.id] ?? []
    : [];
  const resourceConstraintsLoaded = Boolean(
    resource && Object.prototype.hasOwnProperty.call(constraintsByResource, resource.id),
  );
  const multiDayAvailable = resource && resourceConstraintsLoaded
    ? supportsMultiDayReservations(resource, resourceConstraints)
    : false;
  const fullDayOnly = resource && resourceConstraintsLoaded
    ? isFullDayOnlyResource(resource, resourceConstraints)
    : false;
  const resourceHasAvailability = resource && resourceConstraintsLoaded
    ? hasResourceAvailability(resource, resourceConstraints)
    : false;
  const effectiveEndDate = multiDayAvailable ? endDate : startDate;
  const fullDayAvailableForRange =
    resourceConstraintsLoaded &&
    getDateKeysInRange(startDate, effectiveEndDate).length > 0 &&
    getDateKeysInRange(startDate, effectiveEndDate).every((dateKey) =>
      isFullDayAvailable(resource, dateKey, resourceConstraints),
    );
  const isFullDayMode =
    fullDayOnly || (isFullDaySelected && fullDayAvailableForRange);

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function loadResources() {
      setLoading(true);
      setError("");
      try {
        const resourcesUrl = apiUrl("/resources/");
        const payload = await cachedGet(
          resourcesUrl,
          async () => {
            const response = await fetch(resourcesUrl, {
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Could not load resources from the server.");
            }
            return (await response.json()) as Resource[];
          },
          15_000,
        );
        const activeResources = (Array.isArray(payload) ? payload : []).filter(
          (item) => item.is_active,
        );
        if (!active) return;
        setResources(activeResources);
        const storedResourceId =
          sessionStorage.getItem(SELECTED_RESOURCE_STORAGE_KEY) ?? "";
        setResourceId((currentId) => {
          const preferredId = currentId || storedResourceId;
          const nextId = activeResources.some(
            (item) => String(item.id) === preferredId,
          )
            ? preferredId
            : String(activeResources[0]?.id ?? "");
          if (nextId) {
            sessionStorage.setItem(SELECTED_RESOURCE_STORAGE_KEY, nextId);
          } else {
            sessionStorage.removeItem(SELECTED_RESOURCE_STORAGE_KEY);
          }
          return nextId;
        });
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
    const availabilityUrl = apiUrl(
      `/resources/${selectedResource.id}/availability/?${dateQuery.toString()}`,
    );

    async function loadSelectedResourceAvailability() {
      setAvailabilityLoading(true);
      setError("");

      try {
        const constraintsUrl = apiUrl(
          `/resources/${selectedResource.id}/constraints/`,
        );
        const constraintsPromise = cachedGet(
          constraintsUrl,
          async () => {
            const response = await fetch(
              constraintsUrl,
              { credentials: "include" },
            );
            if (!response.ok) {
              throw new Error(
                `Could not load availability rules for ${selectedResource.name}.`,
              );
            }
            return (await response.json()) as AvailabilityConstraint[];
          },
          60_000,
        );
        const availabilityPromise = cachedGet(
          availabilityUrl,
          async () => {
            const response = await fetch(availabilityUrl, {
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error(
                `Could not load reservations for ${selectedResource.name}.`,
              );
            }
            return (await response.json()) as {
              bookings: Array<{
                date: string;
                start_time: string | null;
                end_time: string | null;
                is_full_day: boolean;
                status: "CONFIRMED" | "PENDING" | "CANCELLED";
              }>;
            };
          },
        );
        const [constraints, availability] = await Promise.all([
          constraintsPromise,
          availabilityPromise,
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
            is_full_day: booking.is_full_day,
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
    setStartDate(date);
    setEndDate(date);
    setIsFullDaySelected(false);
    clearSelection();
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!resource || availabilityLoading || !resourceConstraintsLoaded) {
      setDraftRange(null);
      return;
    }
    ignoreClickRef.current = true;

    const rangeStart = Math.min(drag.startMinute, drag.currentMinute);
    const rangeEnd =
      Math.max(drag.startMinute, drag.currentMinute) + SLOT_MINUTES;
    const range: TimeRange = {
      date: drag.date,
      resourceId: drag.resourceId,
      start: rangeStart,
      end: rangeEnd,
    };
    setDraftRange(null);
    setSelectedRange(range);
    setSelectionError(
      validateRange(resource, range, reservations, constraintsByResource[resource.id] ?? []),
    );
    setStartTime(toTimeInputValue(range.start));
    setEndTime(toTimeInputValue(range.end));
    setNotice("");
  }

  useEffect(() => {
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [resource, reservations, availabilityLoading, resourceConstraintsLoaded]);

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
    if (nextResourceId) {
      sessionStorage.setItem(SELECTED_RESOURCE_STORAGE_KEY, nextResourceId);
    } else {
      sessionStorage.removeItem(SELECTED_RESOURCE_STORAGE_KEY);
    }
    setIsFullDaySelected(false);
    clearSelection();
  }

  function getCellStatus(date: string, slotStartMinutes: number): SlotStatus {
    if (!resource) return "unavailable";
    return getSlotStatus(
      resource,
      date,
      slotStartMinutes,
      reservations,
      constraintsByResource[resource.id] ?? [],
    );
  }

  function startDrag(date: string, minute: number) {
    if (!resource) return;
    if (availabilityLoading || !resourceConstraintsLoaded) {
      setSelectionHint("Availability is updating. Please wait before selecting a time.");
      return;
    }
    ignoreClickRef.current = true;
    setNotice("");
    setSelectionError("");
    setSelectionHint("");
    setSelectedDate(date);
    setSelectedRange(null);

    const slotStart = Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
    const status = getCellStatus(date, slotStart);
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
      startMinute: slotStart,
      currentMinute: slotStart,
    };
    setDraftRange({
      resourceId,
      date,
      start: slotStart,
      end: slotStart + SLOT_MINUTES,
    });
  }

  function updateDrag(date: string, minute: number) {
    const drag = dragRef.current;
    if (!drag || !resource) return;
    if (date !== drag.date) {
      setSelectionHint("A reservation range must stay within one date.");
      return;
    }

    const targetMinute = Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
    let acceptedCurrent = drag.startMinute;
    const direction = Math.sign(targetMinute - drag.startMinute);
    let blockedStatus: SlotStatus | null = null;
    let blockedMinute: number | null = null;

    if (direction > 0) {
      for (let candidate = drag.startMinute + SLOT_MINUTES; candidate <= targetMinute; candidate += SLOT_MINUTES) {
        const status = getCellStatus(date, candidate);
        if (status !== "available") {
          blockedStatus = status;
          blockedMinute = candidate;
          break;
        }
        acceptedCurrent = candidate;
      }
    } else if (direction < 0) {
      for (let candidate = drag.startMinute - SLOT_MINUTES; candidate >= targetMinute; candidate -= SLOT_MINUTES) {
        const status = getCellStatus(date, candidate);
        if (status !== "available") {
          blockedStatus = status;
          blockedMinute = candidate;
          acceptedCurrent = candidate + SLOT_MINUTES;
          break;
        }
        acceptedCurrent = candidate;
      }
    }

    drag.currentMinute = acceptedCurrent;
    const rangeStart = Math.min(drag.startMinute, acceptedCurrent);
    const rangeEnd = Math.max(drag.startMinute, acceptedCurrent) + SLOT_MINUTES;
    const range: TimeRange = {
      resourceId: drag.resourceId,
      date: drag.date,
      start: rangeStart,
      end: rangeEnd,
    };
    setDraftRange(range);
    if (blockedStatus && blockedMinute !== null) {
      const blockedTime = formatTime(blockedMinute);
      setSelectionHint(
        blockedStatus === "booked"
          ? `Selection stopped before ${blockedTime}; that period is booked.`
          : `Selection stopped before ${blockedTime}; the resource is unavailable.`,
      );
    } else {
      setSelectionHint("");
    }
  }

  function handleTimelinePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    date: string,
    start: number,
    end: number,
  ) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".timeline-event")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const minute = Math.round((start + (offset / rect.height) * (end - start)) / SLOT_MINUTES) * SLOT_MINUTES;
    startDrag(date, minute);
  }

  function handleTimelinePointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
    date: string,
    start: number,
    end: number,
  ) {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const minute = Math.round((start + (offset / rect.height) * (end - start)) / SLOT_MINUTES) * SLOT_MINUTES;
    updateDrag(date, minute);
  }

  function handleTimelineClick(date: string, event: MouseEvent<HTMLDivElement>, start: number, end: number) {
    if (!resource) return;
    if (event.detail > 0 && ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (event.detail > 0) return;
    if (availabilityLoading || !resourceConstraintsLoaded) {
      setSelectionHint("Availability is updating. Please wait before selecting a time.");
      return;
    }

    setSelectedDate(date);
    setNotice("");
    setSelectionHint("");
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const minute = Math.floor((start + (offset / rect.height) * (end - start)) / SLOT_MINUTES) * SLOT_MINUTES;
    const status = getCellStatus(date, minute);
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
      start: minute,
      end: minute + SLOT_MINUTES,
    };
    setSelectedRange(range);
    setSelectionError("");
  }

  function selectRangeFromControls(
    startValue = startTime,
    endValue = endTime,
  ) {
    if (!resource || availabilityLoading || !resourceConstraintsLoaded) return;
    const selectedEndDate = multiDayAvailable ? endDate : startDate;
    const isFullDay = isFullDayMode;
    const start = isFullDay ? 0 : parseTimeToMinutes(startValue);
    const end = isFullDay ? 24 * 60 : parseTimeToMinutes(endValue);
    const range: TimeRange = {
      date: selectedDate,
      startDate,
      endDate: selectedEndDate,
      resourceId,
      start,
      end,
      isFullDay,
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
    if (
      !selectedRange ||
      selectionError ||
      !resource ||
      !resourceConstraintsLoaded ||
      availabilityLoading ||
      isReserving
    ) return;

    setIsReserving(true);
    try {
      const csrfToken = await requireCsrfToken();
      const selectedStartDate = selectedRange.startDate ?? selectedRange.date;
      const selectedEndDate = selectedRange.endDate ?? selectedRange.date;
      const response = await fetch(apiUrl("/reservations/"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
        },
        body: JSON.stringify({
          resource: Number(resource.id),
          reservation_date: selectedStartDate,
          end_date: selectedEndDate,
          start_time: selectedRange.isFullDay
            ? null
            : toTimeInputValue(selectedRange.start),
          end_time: selectedRange.isFullDay
            ? null
            : toTimeInputValue(selectedRange.end),
          is_full_day: Boolean(selectedRange.isFullDay),
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

      invalidateCachedGets(
        apiUrl("/reservations/"),
        `:${apiUrl("/reservations/")}`,
        apiUrl("/admin/reservations/"),
        apiUrl(`/resources/${resource.id}/availability/`),
      );
      setAvailabilityRevision((current) => current + 1);
      const reservationStartDate = selectedRange.startDate ?? selectedRange.date;
      const reservationEndDate = selectedRange.endDate ?? selectedRange.date;
      const reservationDateLabel =
        reservationStartDate === reservationEndDate
          ? formatDate(reservationStartDate, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : `${formatDate(reservationStartDate, {
              month: "short",
              day: "numeric",
            })} – ${formatDate(reservationEndDate, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}`;
      setNotice(selectedRange.isFullDay
        ? `${resource.name} is reserved all day for ${reservationDateLabel}.`
        : `${resource.name} is reserved for ${reservationDateLabel}, ${formatTimeRange(
            selectedRange.start,
            selectedRange.end,
          )}.`);
      setSelectedRange(null);
      setDraftRange(null);
      setSelectionError("");
    } catch (bookingError) {
      const message =
        bookingError instanceof Error
          ? bookingError.message
          : "The reservation could not be created.";
      setSelectionError(message);
    } finally {
      setIsReserving(false);
    }
  }

  function renderTimeGrid(dates: string[]) {
    const resourceConstraints = resource
      ? constraintsByResource[resource.id] ?? []
      : [];
    const defaultWindow = normalizeBackendAvailabilityWindow(resource);
    const visibleWindows = dates.flatMap((date) =>
      getAvailabilityWindows(resource, date, resourceConstraints),
    );
    const timelineStart = visibleWindows.length
      ? Math.floor(Math.min(...visibleWindows.map((window) => window.start)) / 60) * 60
      : Math.floor(defaultWindow.startTime / 60) * 60;
    const timelineEnd = visibleWindows.length
      ? Math.ceil(Math.max(...visibleWindows.map((window) => window.end)) / 60) * 60
      : Math.ceil(defaultWindow.endTime / 60) * 60;
    const timelineMinutes = Math.max(60, timelineEnd - timelineStart);
    const timelineHeight = (timelineMinutes / 60) * HOUR_HEIGHT_PX;
    const hourLabels = Array.from(
      { length: Math.floor(timelineMinutes / 60) + 1 },
      (_, index) => timelineStart + index * 60,
    );
    const pointForMinute = (minute: number) =>
      ((minute - timelineStart) / timelineMinutes) * timelineHeight;
    const range = draftRange ?? selectedRange;

    return (
      <div
        className="calendar-grid-scroll"
        role="region"
        aria-label={dates.length === 1 ? "Day calendar timeline" : "Week calendar timeline"}
        tabIndex={0}
        aria-busy={availabilityLoading}
      >
        <div
          className={`calendar-time-grid ${dates.length === 1 ? "calendar-time-grid-day" : "calendar-time-grid-week"}`}
          style={{ "--calendar-day-count": dates.length } as CSSProperties}
        >
          <div className="time-grid-header time-grid-time-label">TIME</div>
          {dates.map((date) => (
            <button
                className={[
                  "time-grid-header",
                  "time-grid-day-header",
                  date === selectedDate ? "current" : "",
                  resourceConstraintsLoaded &&
                  getAvailabilityWindows(resource, date, resourceConstraints).length === 0
                    ? "unavailable-day"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              key={date}
              type="button"
              onClick={() => {
                changeDate(date);
              }}
            >
              <span>{formatDate(date, { weekday: "short" })}</span>
              <strong>{formatDate(date, { day: "numeric" })}</strong>
            </button>
          ))}
          <div className="time-grid-body" style={{ height: timelineHeight }}>
            <div className="time-grid-axis" aria-hidden="true">
              {hourLabels.map((minute) => (
                <span
                  className="time-grid-hour-label"
                  key={minute}
                  style={{ top: pointForMinute(minute) }}
                >
                  {formatTime(minute)}
                </span>
              ))}
            </div>
            {dates.map((date) => {
              const windows = getAvailabilityWindows(resource, date, resourceConstraints);
              const unavailableWindows: Array<{ start: number; end: number }> = [];
              let availableUntil = timelineStart;
              for (const window of windows) {
                if (window.start > availableUntil) {
                  unavailableWindows.push({
                    start: availableUntil,
                    end: window.start,
                  });
                }
                availableUntil = Math.max(availableUntil, window.end);
              }
              if (availableUntil < timelineEnd) {
                unavailableWindows.push({
                  start: availableUntil,
                  end: timelineEnd,
                });
              }
              if (windows.length === 0) {
                unavailableWindows.push({
                  start: timelineStart,
                  end: timelineEnd,
                });
              }
              const dateReservations = reservations.filter(
                (reservation) =>
                  reservation.resource === resource?.id &&
                  reservation.reservation_date === date &&
                  reservation.status !== "CANCELLED",
              );
              const dayRange =
                range?.resourceId === resourceId && range.date === date
                  ? range
                  : null;
              const isInvalid =
                Boolean(dayRange) && Boolean(selectionError);

              return (
                <div
                  aria-label={`${formatDate(date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })} schedule. Drag to select a time; time fields below are also available.`}
                  className={`timeline-day ${date === selectedDate ? "current" : ""}`}
                  data-date={date}
                  key={date}
                  role="group"
                  style={{ height: timelineHeight }}
                  onPointerDown={(event) =>
                    handleTimelinePointerDown(event, date, timelineStart, timelineEnd)
                  }
                  onPointerMove={(event) =>
                    handleTimelinePointerMove(event, date, timelineStart, timelineEnd)
                  }
                  onPointerUp={() => finishDrag()}
                  onPointerCancel={() => finishDrag()}
                  onClick={(event) =>
                    handleTimelineClick(date, event, timelineStart, timelineEnd)
                  }
                >
                  {unavailableWindows
                    .filter(
                      (window) =>
                        window.end > window.start &&
                        window.start < timelineEnd &&
                        window.end > timelineStart,
                    )
                    .map((window, index) => (
                      <div
                        aria-hidden="true"
                        className="timeline-unavailable"
                        key={`closed-${index}`}
                        style={{
                          top: pointForMinute(Math.max(window.start, timelineStart)),
                          height:
                            pointForMinute(Math.min(window.end, timelineEnd)) -
                            pointForMinute(Math.max(window.start, timelineStart)),
                        }}
                      />
                    ))}
                  {dateReservations.map((reservation) => {
                      const start = reservation.is_full_day
                        ? 0
                        : parseTimeToMinutes(reservation.start_time);
                      const end = reservation.is_full_day
                        ? 24 * 60
                        : parseTimeToMinutes(reservation.end_time);
                      const timeLabel = reservation.is_full_day
                        ? "All day"
                        : formatTimeRange(start, end);
                      return (
                        <div
                          aria-label={`${reservation.resource_name}, ${timeLabel}, ${reservation.status.toLowerCase()}`}
                        className={`timeline-event timeline-event-${reservation.status.toLowerCase()}`}
                        key={reservation.id || `${date}-${start}-${end}`}
                        role="img"
                        style={{
                          top: pointForMinute(start),
                          height: pointForMinute(end) - pointForMinute(start),
                        }}
                      >
                        <strong>{reservation.resource_name}</strong>
                        <span>{timeLabel}</span>
                      </div>
                    );
                  })}
                  {dayRange && (
                    <div
                      aria-label={`Selected ${formatTimeRange(dayRange.start, dayRange.end)}`}
                      className={`timeline-selection ${isInvalid ? "invalid" : ""}`}
                      style={{
                        top: pointForMinute(dayRange.start),
                        height:
                          pointForMinute(dayRange.end) -
                          pointForMinute(dayRange.start),
                      }}
                    >
                      <span>{formatTimeRange(dayRange.start, dayRange.end)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const rangeForSummary = draftRange ?? selectedRange;
  const startDateAvailabilityWindows = getAvailabilityWindows(
    resource,
    startDate,
    resource ? constraintsByResource[resource.id] ?? [] : [],
  );
  const endDateAvailabilityWindows = getAvailabilityWindows(
    resource,
    effectiveEndDate,
    resource ? constraintsByResource[resource.id] ?? [] : [],
  );
  const startTimeOptions = getTimeOptions(startDateAvailabilityWindows, false);
  const startTimeValue = startTimeOptions.includes(startTime)
    ? startTime
    : startTimeOptions[0] ?? "";
  const endTimeOptions = getEndTimeOptions(
    endDateAvailabilityWindows,
    startTimeValue,
    startDate === effectiveEndDate,
  );
  const endTimeValue = endTimeOptions.includes(endTime)
    ? endTime
    : endTimeOptions[0] ?? "";
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
              className="reservation-resource-picker"
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
                aria-label={
                  view === "month"
                    ? "Previous month"
                    : view === "week"
                      ? "Previous week"
                      : "Previous day"
                }
                onClick={() => navigateCalendar(-1)}
              >
                ‹
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={
                  view === "month"
                    ? "Next month"
                    : view === "week"
                      ? "Next week"
                      : "Next day"
                }
                onClick={() => navigateCalendar(1)}
              >
                ›
              </button>
            </div>
            <button
              className="button button-secondary calendar-today-button"
              type="button"
              onClick={() => changeDate(getReservationClock().date)}
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

        {isLoading ? (
          <div className="inline-notice" role="status">
            Loading resources…
          </div>
        ) : resources.length === 0 ? (
          <div className="inline-notice inline-notice-error" role="alert">
            No active resources are currently available.
          </div>
        ) : null}
        {availabilityLoading && !isLoading && resources.length > 0 && (
          <p className="calendar-loading-status" role="status">
            Updating availability…
          </p>
        )}
        {!isLoading && resources.length > 0 && view === "month" ? (
          <div
            className="month-calendar"
            role="region"
            aria-label={`${monthTitle} availability`}
            tabIndex={0}
            aria-busy={availabilityLoading}
          >
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
                const dateHasAvailability =
                  getAvailabilityWindows(
                    resource,
                    date,
                    resource ? constraintsByResource[resource.id] ?? [] : [],
                  ).length > 0;
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
                      resourceConstraintsLoaded && !dateHasAvailability
                        ? "unavailable-day"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={date}
                    type="button"
                    onClick={() => {
                      changeDate(date);
                    }}
                  >
                    <span className="month-date-number">
                      {dateObject.getDate()}
                    </span>
                    <span className={`date-availability date-${availability}`}>
                      <i aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : !isLoading && resources.length > 0 ? (
          renderTimeGrid(visibleDates)
        ) : null}

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
          {resourceConstraintsLoaded && resourceHasAvailability ? (
            <div className="range-controls">
              <div className="form-control">
                <span>{multiDayAvailable ? "Reserve From" : "Reserve date"}</span>
                <ReservationDatePicker
                  label={multiDayAvailable ? "Reserve From" : "Reserve date"}
                  value={startDate}
                  onChange={(date) => {
                    setSelectedDate(date);
                    setStartDate(date);
                    if (!multiDayAvailable) setEndDate(date);
                    setIsFullDaySelected(false);
                    setSelectedRange(null);
                    setSelectionError("");
                    setSelectionHint("");
                  }}
                />
              </div>
              {multiDayAvailable && (
                <div className="form-control">
                  <span>Reserve Until</span>
                  <ReservationDatePicker
                    label="Reserve Until"
                    value={endDate}
                    onChange={(date) => {
                      setEndDate(date);
                      setIsFullDaySelected(false);
                      setSelectedRange(null);
                      setSelectionError("");
                      setSelectionHint("");
                    }}
                  />
                </div>
              )}
              {!isFullDayMode && (
                <>
                  <label className="form-control">
                    <span>Start Time</span>
                    <select
                      required
                      value={startTimeValue}
                      disabled={startTimeOptions.length === 0}
                      onChange={(event) => {
                        setStartTime(event.target.value);
                        setSelectedRange(null);
                        setSelectionError("");
                        setSelectionHint("");
                      }}
                    >
                      {startTimeOptions.length === 0 ? (
                        <option value="">No available times</option>
                      ) : (
                        startTimeOptions.map((time) => (
                          <option key={time} value={time}>
                            {formatTime(parseTimeToMinutes(time))}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="form-control">
                    <span>End Time</span>
                    <select
                      required
                      value={endTimeValue}
                      disabled={endTimeOptions.length === 0}
                      onChange={(event) => {
                        setEndTime(event.target.value);
                        setSelectedRange(null);
                        setSelectionError("");
                        setSelectionHint("");
                      }}
                    >
                      {endTimeOptions.length === 0 ? (
                        <option value="">No available end times</option>
                      ) : (
                        endTimeOptions.map((time) => (
                          <option key={time} value={time}>
                            {formatTime(parseTimeToMinutes(time))}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </>
              )}
              {!fullDayOnly && fullDayAvailableForRange && (
                <label className="full-day-toggle">
                  <input
                    checked={isFullDaySelected}
                    type="checkbox"
                    onChange={(event) => {
                      setIsFullDaySelected(event.target.checked);
                      setSelectedRange(null);
                      setSelectionError("");
                      setSelectionHint("");
                    }}
                  />
                  <span>Reserve all day</span>
                </label>
              )}
              <button
                className="button button-secondary apply-range-button"
                type="button"
                disabled={
                  availabilityLoading ||
                  (!isFullDayMode &&
                    (startTimeOptions.length === 0 || endTimeOptions.length === 0))
                }
                onClick={() => selectRangeFromControls(startTimeValue, endTimeValue)}
              >
                Apply range
              </button>
            </div>
          ) : resourceConstraintsLoaded ? (
            <p className="range-controls-loading" role="status">
              No availability is configured for this resource.
            </p>
          ) : (
            <p className="range-controls-loading" role="status">
              Loading availability rules…
            </p>
          )}
        </div>
        <div className="reservation-summary">
          <div className="reservation-summary-details">
            <div className="reservation-summary-title">
              <span className="summary-label">Reservation Summary</span>
            </div>
            {rangeForSummary ? (
              <dl className="reservation-summary-fields">
                <div>
                  <dt>Resource</dt>
                  <dd>{resource?.name ?? "Resource"}</dd>
                </div>
                <div>
                  <dt>
                    {(rangeForSummary.startDate ?? rangeForSummary.date) ===
                    (rangeForSummary.endDate ?? rangeForSummary.date)
                      ? "Date"
                      : "Dates"}
                  </dt>
                  <dd>
                    {(rangeForSummary.startDate ?? rangeForSummary.date) ===
                    (rangeForSummary.endDate ?? rangeForSummary.date)
                      ? formatDate(
                          rangeForSummary.startDate ?? rangeForSummary.date,
                          {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          },
                        )
                      : `${formatDate(
                          rangeForSummary.startDate ?? rangeForSummary.date,
                          { month: "short", day: "numeric" },
                        )} – ${formatDate(
                          rangeForSummary.endDate ?? rangeForSummary.date,
                          { month: "short", day: "numeric", year: "numeric" },
                        )}`}
                  </dd>
                </div>
                <div>
                  <dt>{rangeForSummary.isFullDay ? "Availability" : "Time"}</dt>
                  <dd>
                    {rangeForSummary.isFullDay
                      ? "Full day"
                      : formatTimeRange(rangeForSummary.start, rangeForSummary.end)}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {rangeForSummary.isFullDay
                      ? `${getDateKeysInRange(
                          rangeForSummary.startDate ?? rangeForSummary.date,
                          rangeForSummary.endDate ?? rangeForSummary.date,
                        ).length * 24} hours`
                      : formatDuration(
                          (getDateKeysInRange(
                            rangeForSummary.startDate ?? rangeForSummary.date,
                            rangeForSummary.endDate ?? rangeForSummary.date,
                          ).length -
                            1) *
                            24 *
                            60 +
                            rangeForSummary.end -
                            rangeForSummary.start,
                        )}
                  </dd>
                </div>
              </dl>
            ) : null}
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
              disabled={
                !selectedRange ||
                Boolean(rangeValidation) ||
                availabilityLoading ||
                !resourceConstraintsLoaded ||
                isReserving
              }
              onClick={reserveSelectedRange}
            >
              {isReserving ? "Reserving…" : "Reserve"}
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
