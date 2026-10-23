import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { adminApi } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";

type Resource = {
  id: number;
  name: string;
  resource_type: string;
  description: string;
  location: string;
  is_active: boolean;
  default_start_time: string;
  default_end_time: string;
};

type Constraint = {
  id: number;
  resource: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_full_day: boolean;
  is_active: boolean;
};

const weekdays = [
  { short: "Mon", name: "Monday", day: 0 },
  { short: "Tue", name: "Tuesday", day: 1 },
  { short: "Wed", name: "Wednesday", day: 2 },
  { short: "Thu", name: "Thursday", day: 3 },
  { short: "Fri", name: "Friday", day: 4 },
  { short: "Sat", name: "Saturday", day: 5 },
  { short: "Sun", name: "Sunday", day: 6 },
];

function formatTime(value: string) {
  const rawValue = value.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(AM|PM)?$/i.exec(
    rawValue,
  );
  if (!match) return rawValue;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  const fraction = match[4] ?? "";
  const meridiem = match[5]?.toUpperCase();
  if (
    minutes > 59 ||
    seconds > 59 ||
    (meridiem ? hours < 1 || hours > 12 : hours > 23)
  ) {
    return rawValue;
  }
  if (meridiem) {
    hours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
  }

  const formatted = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  if (seconds === 0 && !fraction) return formatted;
  return `${formatted}:${String(seconds).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}

function timeSortValue(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(formatTime(value));
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? "0");
}

type AvailabilityWindow = {
  start_time: string;
  end_time: string;
  is_full_day: boolean;
};

type DaySchedule = {
  name: string;
  short: string;
  windows: AvailabilityWindow[];
  signature: string;
};

function getDaySchedules(
  resource: Resource,
  constraints: Constraint[],
): DaySchedule[] {
  const defaultIsFullDay =
    timeSortValue(resource.default_start_time) === 0 &&
    formatTime(resource.default_end_time) === "23:59";

  return weekdays.map(({ day, name, short }) => {
    const windows: AvailabilityWindow[] =
      constraints.length === 0
        ? [{
            start_time: resource.default_start_time,
            end_time: resource.default_end_time,
            is_full_day: defaultIsFullDay,
          }]
        : constraints
            .filter(
              (constraint) =>
                constraint.day_of_week === day && constraint.is_active,
            )
            .sort(
              (left, right) =>
                timeSortValue(left.start_time) - timeSortValue(right.start_time),
            );
    return {
      name,
      short,
      windows,
      signature: windows
        .map((window) =>
          window.is_full_day
            ? "full-day"
            : `${formatTime(window.start_time)}-${formatTime(window.end_time)}`,
        )
        .join("|"),
    };
  });
}

function getConsecutiveDayRanges(days: DaySchedule[]) {
  const ranges: Array<{ start: number; end: number; signature: string }> = [];
  days.forEach((day, index) => {
    if (!day.signature) return;
    const previous = ranges[ranges.length - 1];
    if (previous && previous.signature === day.signature && previous.end === index - 1) {
      previous.end = index;
    } else {
      ranges.push({ start: index, end: index, signature: day.signature });
    }
  });
  return ranges;
}

function formatDayRange(days: DaySchedule[], start: number, end: number) {
  return start === end
    ? days[start].short
    : `${days[start].short}–${days[end].short}`;
}

function formatAvailabilitySummary(resourceId: number, days: DaySchedule[]) {
  const availableDays = days.filter((day) => day.windows.length > 0);
  if (!availableDays.length) return "No availability";

  const signatures = new Set(availableDays.map((day) => day.signature));
  const isUniform = signatures.size === 1;
  if (isUniform && availableDays[0].windows.every((window) => window.is_full_day)) {
    const ranges = getConsecutiveDayRanges(days)
      .map(({ start, end }) => formatDayRange(days, start, end));
    const dayBlock = availableDays.length === 7 ? "All week" : ranges.join(", ");
    return (
      <span className="availability-full-day-summary">
        {dayBlock} · Full day
      </span>
    );
  }

  if (!isUniform) {
    return (
      <span className="availability-varies">
        <span>Varies ·</span>
        <AvailabilityDetails resourceId={resourceId} days={days} />
      </span>
    );
  }

  const schedule = availableDays[0].windows
    .map(
      (window) =>
        `${formatTime(window.start_time)} – ${formatTime(window.end_time)}`,
    )
    .join(", ");
  const ranges = getConsecutiveDayRanges(days)
    .map(({ start, end }) => formatDayRange(days, start, end));
  const dayBlock =
    availableDays.length === 7 && ranges.length === 1
      ? "Mon–Sun"
      : ranges.join(", ");
  return (
    <span className="availability-uniform-summary">
      {dayBlock} • {schedule}
    </span>
  );
}

function AvailabilityDetails({
  resourceId,
  days,
}: {
  resourceId: number;
  days: DaySchedule[];
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const popoverId = `availability-details-${resourceId}`;

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - width - 12),
    );
    const popoverHeight = popoverRef.current?.offsetHeight ?? 300;
    const top =
      rect.bottom + popoverHeight + 12 <= window.innerHeight
        ? rect.bottom + 8
        : Math.max(12, rect.top - popoverHeight - 8);
    setPosition({ left, top });
  }

  function cancelScheduledClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      if (!pinned) setOpen(false);
    }, 140);
  }

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPinned(false);
        triggerRef.current?.focus();
      }
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
        setPinned(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      cancelScheduledClose();
    };
  }, [open, pinned]);

  return (
    <span
      className="availability-details-trigger"
      onMouseEnter={() => {
        cancelScheduledClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        className="availability-details-link"
        onBlur={() => {
          if (!pinned) scheduleClose();
        }}
        onClick={() => {
          cancelScheduledClose();
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => {
          cancelScheduledClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        ref={triggerRef}
        type="button"
      >
        Details
      </button>
      {open &&
        createPortal(
          <div
            aria-label="Weekly availability details"
            className="availability-details-popover"
            id={popoverId}
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={scheduleClose}
            ref={popoverRef}
            role="dialog"
            style={{ left: position.left, top: position.top }}
          >
            <div className="availability-details-heading">Weekly schedule</div>
            <ul className="availability-details-list">
              {days.map((day) => (
                <li className="availability-details-row" key={day.name}>
                  <span>{day.name}</span>
                  <span className={day.windows.length ? "" : "is-unavailable"}>
                    {day.windows.length
                      ? day.windows
                          .map((window) =>
                            window.is_full_day
                              ? "Full Day"
                              : `${formatTime(window.start_time)} – ${formatTime(window.end_time)}`,
                          )
                          .join(", ")
                      : "🚫 Un-available"}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </span>
  );
}

function formatAvailability(
  resourceId: number,
  resource: Resource,
  constraints: Constraint[] | undefined,
): ReactNode {
  if (constraints === undefined) return "Availability unavailable";
  return formatAvailabilitySummary(resourceId, getDaySchedules(resource, constraints));
}

export function AdminResourcesPage() {
  const location = useLocation();
  const [resources, setResources] = useState<Resource[]>([]);
  const [constraintsByResource, setConstraintsByResource] = useState<
    Record<number, Constraint[]>
  >({});
  const [availabilityErrors, setAvailabilityErrors] = useState<
    Record<number, string>
  >({});
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    typeof location.state?.notice === "string" ? location.state.notice : "",
  );

  async function loadResources() {
    setLoading(true);
    setError("");
    try {
      const [resourcesResult, constraintsResult] = await Promise.allSettled([
        adminApi<Resource[]>("/resources/", {}, "Could not load resources."),
        adminApi<Constraint[]>(
          "/resources/constraints/",
          {},
          "Could not load resource availability.",
        ),
      ]);
      if (resourcesResult.status === "rejected") {
        throw resourcesResult.reason;
      }

      const nextResources = resourcesResult.value;
      setResources(nextResources);
      if (nextResources.length === 0) {
        setConstraintsByResource({});
        setAvailabilityErrors({});
        return;
      }
      try {
        if (constraintsResult.status === "rejected") {
          throw constraintsResult.reason;
        }
        const allConstraints = constraintsResult.value;
        const constraints = Object.fromEntries(
          nextResources.map((resource) => [resource.id, [] as Constraint[]]),
        ) as Record<number, Constraint[]>;
        allConstraints.forEach((constraint) => {
          constraints[constraint.resource]?.push(constraint);
        });
        setConstraintsByResource(constraints);
        setAvailabilityErrors({});
      } catch (availabilityError) {
        setConstraintsByResource({});
        setAvailabilityErrors(
          Object.fromEntries(
            nextResources.map((resource) => [
              resource.id,
              availabilityError instanceof Error
                ? availabilityError.message
                : `Could not load availability for ${resource.name}.`,
            ]),
          ),
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load resources.",
      );
      setResources([]);
      setConstraintsByResource({});
      setAvailabilityErrors({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResources();
  }, []);

  async function deleteResource() {
    if (!resourceToDelete) return;
    setDeleting(true);
    setError("");
    try {
      await adminApi<void>(
        `/resources/${resourceToDelete.id}/`,
        { method: "DELETE" },
        "Could not delete this resource.",
      );
      setResourceToDelete(null);
      setNotice(`${resourceToDelete.name} was deleted.`);
      setResources((current) =>
        current.filter((resource) => resource.id !== resourceToDelete.id),
      );
      setConstraintsByResource((current) => {
        const { [resourceToDelete.id]: _deleted, ...remaining } = current;
        return remaining;
      });
      setAvailabilityErrors((current) => {
        const { [resourceToDelete.id]: _deleted, ...remaining } = current;
        return remaining;
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete this resource.",
      );
      setResourceToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Resources"
        action={
          <Link className="button button-primary" to="/admin/resources/add">
            <span aria-hidden="true">＋</span> Add resource
          </Link>
        }
      />
      {notice && (
        <div className="inline-notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="inline-notice inline-notice-error" role="alert">
          {error}
        </div>
      )}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Resources</h2>
            <p>{loading ? "Loading…" : `${resources.length} resources`}</p>
          </div>
        </div>
        <div className="table-scroll admin-mobile-card-table-scroll" role="region" aria-label="Resources table" tabIndex={0}>
          <table className="data-table admin-mobile-card-table">
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Type</th>
                <th scope="col">Location</th>
                <th scope="col">Availability</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && resources.map((resource) => (
                <tr key={resource.id}>
                  <td data-label="Resource">
                    <strong>{resource.name}</strong>
                    <small className="table-subtext">{resource.description}</small>
                  </td>
                  <td data-label="Type">{resource.resource_type}</td>
                  <td data-label="Location">{resource.location || "—"}</td>
                  <td className="availability-cell" data-label="Availability">
                    <span className="availability-summary">
                      {availabilityErrors[resource.id] ??
                        formatAvailability(
                          resource.id,
                          resource,
                          constraintsByResource[resource.id],
                        )}
                    </span>
                  </td>
                  <td data-label="Status">
                    <span className={`status-badge status-${resource.is_active ? "active" : "inactive"}`}>
                      <span className="status-dot" aria-hidden="true" />
                      {resource.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="table-actions">
                      <Link
                        className="table-action"
                        to={`/admin/resources/edit?resourceId=${resource.id}`}
                        aria-label={`Edit ${resource.name}`}
                      >
                        Edit
                      </Link>
                      <button
                        className="table-action table-action-danger"
                        type="button"
                        onClick={() => setResourceToDelete(resource)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td className="empty-table" colSpan={6}>Loading resources…</td></tr>
              )}
              {!loading && resources.length === 0 && (
                <tr><td className="empty-table" colSpan={6}>No resources are available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {resourceToDelete && (
        <ConfirmDialog
          title="Delete this resource?"
          message={`Permanently delete ${resourceToDelete.name}, its availability rules, and all related reservations, including current or upcoming bookings? This cannot be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete resource"}
          onCancel={() => {
            if (!deleting) setResourceToDelete(null);
          }}
          onConfirm={() => void deleteResource()}
        />
      )}
    </div>
  );
}
