import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { PageHeading } from "../../components/PageHeading";
import {
  demoReservations,
  demoResources,
  type Reservation,
  type Resource,
} from "../../data/demoData";
import {
  getSessionReservations,
  saveSessionReservations,
} from "../../data/demoSessionReservations";

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

function getResource(resourceId: string) {
  return demoResources.find((resource) => resource.id === resourceId) ??
    demoResources[0];
}

function getSlotStatus(
  resource: Resource,
  dateKey: string,
  slotIndex: number,
  reservations: Reservation[] = demoReservations,
): SlotStatus {
  const date = fromDateKey(dateKey);
  const availability = resource.weeklyAvailability[date.getDay()];
  const slotStart = `${String(FIRST_HOUR + slotIndex).padStart(2, "0")}:00`;
  const slotEnd = `${String(FIRST_HOUR + slotIndex + 1).padStart(2, "0")}:00`;

  if (
    resource.status !== "Active" ||
    !availability ||
    slotStart < availability.startTime ||
    slotEnd > availability.endTime
  ) {
    return "unavailable";
  }

  const hasBooking = reservations.some((reservation) => {
    if (
      reservation.status === "Cancelled" ||
      reservation.resource !== resource.name ||
      reservation.date !== dateKey
    ) {
      return false;
    }
    return (
      reservation.startTime < slotEnd && reservation.endTime > slotStart
    );
  });

  return hasBooking ? "booked" : "available";
}

function validateRange(
  resource: Resource,
  range: TimeRange,
  reservations: Reservation[] = demoReservations,
) {
  if (range.end <= range.start) {
    return "Choose an end time after the start time.";
  }

  for (let slot = range.start; slot < range.end; slot += 1) {
    const status = getSlotStatus(resource, range.date, slot, reservations);
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
  resource: Resource,
  dateKey: string,
  reservations: Reservation[],
): DateAvailability {
  const statuses = SLOT_STARTS.map((slot) =>
    getSlotStatus(resource, dateKey, slot - FIRST_HOUR, reservations),
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

export function ResourcesPage() {
  const [resourceId, setResourceId] = useState(demoResources[0].id);
  const [sessionReservations, setSessionReservations] =
    useState(getSessionReservations);
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
  const dragRef = useRef<DragRange | null>(null);
  const ignoreClickRef = useRef(false);

  const resource = getResource(resourceId);
  const reservations = useMemo(
    () => [...demoReservations, ...sessionReservations],
    [sessionReservations],
  );
  const reservationsRef = useRef(reservations);
  reservationsRef.current = reservations;
  const selectedDateObject = fromDateKey(selectedDate);
  const monthDates = useMemo(
    () => getMonthDates(selectedDateObject),
    [selectedDateObject.getFullYear(), selectedDateObject.getMonth()],
  );
  const weekDates = useMemo(
    () => getWeekDates(selectedDateObject),
    [selectedDate],
  );
  const visibleDates =
    view === "day" ? [selectedDate] : view === "week" ? weekDates : [selectedDate];

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
    if (!drag) return;
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
      validateRange(
        getResource(drag.resourceId),
        range,
        reservationsRef.current,
      ),
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
  }, []);

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
    return getSlotStatus(resource, date, slotIndex, reservations);
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
    setSelectionError(validateRange(resource, range, reservations));
    setSelectionHint("");
    setNotice("");
  }

  function reserveSelectedRange() {
    if (!selectedRange || selectionError) return;
    const reservation: Reservation = {
      id: `DEMO-${Date.now()}`,
      user: "Jordan Davis",
      resource: resource.name,
      date: selectedRange.date,
      startTime: `${String(FIRST_HOUR + selectedRange.start).padStart(2, "0")}:00`,
      endTime: `${String(FIRST_HOUR + selectedRange.end).padStart(2, "0")}:00`,
      status: "Confirmed",
    };
    const updatedReservations = [...sessionReservations, reservation];
    saveSessionReservations(updatedReservations);
    setSessionReservations(updatedReservations);
    setNotice(
      `${resource.name} selected for ${formatDate(selectedRange.date, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}, ${formatHourRange(
        FIRST_HOUR + selectedRange.start,
        FIRST_HOUR + selectedRange.end,
      )}. This is a frontend-only preview.`,
    );
    setSelectedRange(null);
    setDraftRange(null);
    setSelectionError("");
  }

  function startDrag(date: string, slotIndex: number) {
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
    if (!drag) return;
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
      <div className="calendar-grid-scroll">
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
    ? validateRange(resource, rangeForSummary)
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
        <div className="calendar-toolbar">
          <label className="form-control calendar-resource-select">
            <span>Resource</span>
            <select
              value={resourceId}
              onChange={(event) => changeResource(event.target.value)}
            >
              {demoResources
                .filter((item) => item.status === "Active")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.type}
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

        {view === "month" ? (
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
                );
                return (
                  <button
                    aria-label={`${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}: ${availability} availability for ${resource.name}`}
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
            <h2>{resource.name} schedule</h2>
            <p>
              {resource.location} ·{" "}
              {formatDate(selectedDate, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <span className="resource-type-pill">{resource.type}</span>
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
                  <dd>{resource.name}</dd>
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
