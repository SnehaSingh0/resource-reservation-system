import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
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
  is_active: boolean;
  notes: string;
};

type AvailabilityRow = {
  startTime: string;
  endTime: string;
  active: boolean;
};

type ResourceFormData = {
  resource?: Resource;
  constraints: Constraint[];
  availability: Record<number, AvailabilityRow>;
};

const weekdays = [
  { label: "Monday", day: 1 },
  { label: "Tuesday", day: 2 },
  { label: "Wednesday", day: 3 },
  { label: "Thursday", day: 4 },
  { label: "Friday", day: 5 },
  { label: "Saturday", day: 6 },
  { label: "Sunday", day: 0 },
];

function toBackendWeekday(jsDay: number) {
  return (jsDay + 6) % 7;
}

function toFormData(
  resource: Resource | undefined,
  constraints: Constraint[],
): ResourceFormData {
  const availability: Record<number, AvailabilityRow> = {};
  const configuredDays = new Set(constraints.map((item) => item.day_of_week));
  for (const { day } of weekdays) {
    const backendDay = toBackendWeekday(day);
    const dayConstraints = constraints
      .filter((item) => item.day_of_week === backendDay)
      .sort((left, right) => left.start_time.localeCompare(right.start_time));
    const activeConstraint = dayConstraints.find((item) => item.is_active);
    const savedConstraint = activeConstraint ?? dayConstraints[0];
    const hasConfiguredConstraints = constraints.length > 0;
    availability[day] = {
      startTime: (savedConstraint?.start_time ?? resource?.default_start_time ?? "09:00").slice(0, 5),
      endTime: (savedConstraint?.end_time ?? resource?.default_end_time ?? "17:00").slice(0, 5),
      active: savedConstraint
        ? Boolean(activeConstraint)
        : hasConfiguredConstraints
          ? false
          : resource
            ? true
            : day >= 1 && day <= 5,
    };
    if (!configuredDays.has(backendDay) && !hasConfiguredConstraints && !resource) {
      availability[day].active = day >= 1 && day <= 5;
    }
  }
  return { resource, constraints, availability };
}

function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function ResourceFormPage({ mode }: { mode: "add" | "edit" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editing = mode === "edit";
  const resourceId = searchParams.get("resourceId");
  const [formData, setFormData] = useState<ResourceFormData>(() => toFormData(undefined, []));
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadResource() {
      if (!editing) return;
      if (!resourceId || !/^\d+$/.test(resourceId)) {
        setError("A valid resource must be selected for editing.");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [resource, constraints] = await Promise.all([
          adminApi<Resource>(`/resources/${resourceId}/`, {}, "Could not load the resource."),
          adminApi<Constraint[]>(`/resources/${resourceId}/constraints/`, {}, "Could not load availability."),
        ]);
        if (active) setFormData(toFormData(resource, constraints));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the resource.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadResource();
    return () => {
      active = false;
    };
  }, [editing, resourceId]);

  async function saveAvailability(
    resourceIdToSave: number,
    constraints: Constraint[],
    values: Record<number, AvailabilityRow>,
  ) {
    for (const constraint of constraints) {
      await adminApi<Constraint>(
        `/resource-constraints/${constraint.id}/`,
        { method: "PUT", body: JSON.stringify({ is_active: false }) },
        "Could not update existing availability.",
      );
    }

    for (const { day } of weekdays) {
      const backendDay = toBackendWeekday(day);
      const value = values[day];
      const body = {
        day_of_week: backendDay,
        start_time: value.startTime,
        end_time: value.endTime,
        is_active: value.active,
      };
      const existing = constraints.find((constraint) => constraint.day_of_week === backendDay);
      if (existing) {
        await adminApi<Constraint>(
          `/resource-constraints/${existing.id}/`,
          { method: "PUT", body: JSON.stringify(body) },
          `Could not save ${weekdays.find((item) => item.day === day)?.label ?? "weekday"} availability.`,
        );
      } else {
        await adminApi<Constraint>(
          `/resources/${resourceIdToSave}/constraints/`,
          { method: "POST", body: JSON.stringify(body) },
          `Could not save ${weekdays.find((item) => item.day === day)?.label ?? "weekday"} availability.`,
        );
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const availability: Record<number, AvailabilityRow> = {};

    for (const { day, label } of weekdays) {
      const key = label.toLowerCase();
      const startTime = String(data.get(`${key}Start`) ?? "");
      const endTime = String(data.get(`${key}End`) ?? "");
      const active = data.get(`${key}Available`) === "on";
      if (active && (!startTime || !endTime || parseTime(startTime) >= parseTime(endTime))) {
        setError(`${label} availability must end after it starts.`);
        return;
      }
      availability[day] = { startTime, endTime, active };
    }

    const name = String(data.get("name") ?? "").trim();
    const location = String(data.get("location") ?? "").trim();
    const resourceType = String(data.get("type") ?? "").trim();
    if (!name || !location || !resourceType) {
      setError("Resource name, type, and location are required.");
      return;
    }
    const defaultWindows = Object.values(availability).filter((window) => window.active);
    const sortedEndTimes = defaultWindows.map((window) => window.endTime).sort();
    const resourcePayload = {
      name,
      resource_type: resourceType,
      description: String(data.get("description") ?? "").trim(),
      location,
      is_active: data.get("status") === "Active",
      default_start_time: defaultWindows.map((window) => window.startTime).sort()[0] ?? "09:00",
      default_end_time: sortedEndTimes[sortedEndTimes.length - 1] ?? "18:00",
    };

    setSaving(true);
    let savedResource: Resource | undefined;
    try {
      savedResource = editing && formData.resource
        ? await adminApi<Resource>(
            `/resources/${formData.resource.id}/`,
            { method: "PUT", body: JSON.stringify(resourcePayload) },
            "Could not update the resource.",
          )
        : await adminApi<Resource>(
            "/resources/",
            { method: "POST", body: JSON.stringify(resourcePayload) },
            "Could not create the resource.",
          );

      try {
        await saveAvailability(savedResource.id, formData.constraints, availability);
      } catch (availabilityError) {
        setError(
          `The resource details were saved, but availability could not be fully updated: ${
            availabilityError instanceof Error
              ? availabilityError.message
              : "Unknown availability error."
          }`,
        );
        return;
      }

      navigate("/admin/resources", {
        state: { notice: `${savedResource.name} was ${editing ? "updated" : "created"}.` },
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the resource.");
    } finally {
      setSaving(false);
    }
  }

  const resource = formData.resource;
  const isReady = !loading && (!editing || Boolean(resource));

  return (
    <div className="content-stack">
      <PageHeading
        title={editing ? "Edit Resource" : "Add Resource"}
        description={
          editing
            ? "Update the resource details and availability."
            : "Add a resource that employees can reserve."
        }
      />
      {error && (
        <div className="inline-notice inline-notice-error" role="alert">
          {error}
        </div>
      )}
      {loading && <div className="inline-notice" role="status">Loading resource…</div>}
      {isReady && (
        <form className="panel resource-form-panel" onSubmit={(event) => void handleSubmit(event)}>
          <div className="form-grid">
            <label className="form-control">
              <span>Resource name</span>
              <input name="name" placeholder="e.g. Conference Room A" defaultValue={resource?.name ?? ""} required />
            </label>
            <label className="form-control">
              <span>Resource type</span>
              <select name="type" defaultValue={resource?.resource_type ?? "Room"}>
                {resource && ![
                  "Room",
                  "Meeting Room",
                  "Conference Room",
                  "Lab",
                  "Vehicle",
                  "Equipment",
                  "Laptop",
                  "Projector",
                ].includes(resource.resource_type) && (
                  <option value={resource.resource_type}>{resource.resource_type}</option>
                )}
                <option>Room</option>
                <option>Meeting Room</option>
                <option>Conference Room</option>
                <option>Lab</option>
                <option>Vehicle</option>
                <option>Equipment</option>
                <option>Laptop</option>
                <option>Projector</option>
              </select>
            </label>
            <label className="form-control form-grid-full">
              <span>Description</span>
              <textarea name="description" rows={3} placeholder="Briefly describe this resource" defaultValue={resource?.description ?? ""} />
            </label>
            <label className="form-control form-grid-full">
              <span>Location</span>
              <input name="location" placeholder="Building or floor" defaultValue={resource?.location ?? ""} required />
            </label>
            <fieldset className="form-control form-grid-full availability-days">
              <legend>Weekly availability</legend>
              <p className="availability-description">
                Set an availability window for each day. Clear the checkbox for days when this resource cannot be reserved.
              </p>
              <div className="weekly-availability-table">
                <div className="weekly-availability-header" aria-hidden="true">
                  <span>Day</span><span>Available</span><span>From</span><span>Until</span>
                </div>
                {weekdays.map(({ day, label }) => {
                  const configured = formData.availability[day];
                  const key = label.toLowerCase();
                  return (
                    <div className="weekly-availability-row" key={label}>
                      <strong>{label}</strong>
                      <label className="availability-checkbox">
                        <input type="checkbox" name={`${key}Available`} defaultChecked={configured.active} />
                        <span className="visually-hidden">{label} available</span>
                      </label>
                      <input aria-label={`${label} available from`} type="time" name={`${key}Start`} defaultValue={configured.startTime} required={configured.active} />
                      <input aria-label={`${label} available until`} type="time" name={`${key}End`} defaultValue={configured.endTime} required={configured.active} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <label className="form-control">
              <span>Status</span>
              <select name="status" defaultValue={resource ? (resource.is_active ? "Active" : "Inactive") : "Active"}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </label>
          </div>
          <p className="form-helper">
            Changes are saved to the reservation system and availability rules.
          </p>
          <div className="form-actions">
            <Link className="button button-secondary" to="/admin/resources">Cancel</Link>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add resource"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
