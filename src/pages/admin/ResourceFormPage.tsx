import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeading } from "../../components/PageHeading";
import { demoResources } from "../../data/demoData";

type ResourceFormPageProps = {
  mode: "add" | "edit";
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

export function ResourceFormPage({ mode }: ResourceFormPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editing = mode === "edit";
  const resource =
    demoResources.find((item) => item.id === searchParams.get("resourceId")) ??
    demoResources[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/admin/resources");
  }

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
      <form className="panel resource-form-panel" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="form-control">
            <span>Resource name</span>
            <input
              name="name"
              placeholder="e.g. Conference Room A"
              defaultValue={editing ? resource.name : ""}
              required
            />
          </label>
          <label className="form-control">
            <span>Resource type</span>
            <select name="type" defaultValue={editing ? resource.type : "Room"}>
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
            <textarea
              name="description"
              rows={3}
              placeholder="Briefly describe this resource"
              defaultValue={editing ? resource.description : ""}
            />
          </label>
          <label className="form-control form-grid-full">
            <span>Location</span>
            <input
              name="location"
              placeholder="Building or floor"
              defaultValue={editing ? resource.location : ""}
              required
            />
          </label>
          <fieldset className="form-control form-grid-full availability-days">
            <legend>Weekly availability</legend>
            <p className="availability-description">
              Set an availability window for each day. Clear the checkbox for
              days when this resource cannot be reserved.
            </p>
            <div className="weekly-availability-table">
              <div className="weekly-availability-header" aria-hidden="true">
                <span>Day</span>
                <span>Available</span>
                <span>From</span>
                <span>Until</span>
              </div>
              {weekdays.map(({ day, label }) => {
                const configured = editing
                  ? resource.weeklyAvailability[day]
                  : day >= 1 && day <= 5
                    ? { startTime: "09:00", endTime: "17:00" }
                    : null;
                const key = label.toLowerCase();
                return (
                  <div className="weekly-availability-row" key={label}>
                    <strong>{label}</strong>
                    <label className="availability-checkbox">
                      <input
                        type="checkbox"
                        name={`${key}Available`}
                        defaultChecked={Boolean(configured)}
                      />
                      <span className="visually-hidden">
                        {label} available
                      </span>
                    </label>
                    <input
                      aria-label={`${label} available from`}
                      type="time"
                      name={`${key}Start`}
                      defaultValue={
                        configured?.startTime ??
                        (editing ? resource.startTime : "09:00")
                      }
                    />
                    <input
                      aria-label={`${label} available until`}
                      type="time"
                      name={`${key}End`}
                      defaultValue={
                        configured?.endTime ??
                        (editing ? resource.endTime : "17:00")
                      }
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>
          <label className="form-control">
            <span>Status</span>
            <select
              name="status"
              defaultValue={editing ? resource.status : "Active"}
            >
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
        </div>
        <p className="form-helper">
          Form submission is a visual demo; changes are not saved.
        </p>
        <div className="form-actions">
          <Link className="button button-secondary" to="/admin/resources">
            Cancel
          </Link>
          <button className="button button-primary" type="submit">
            {editing ? "Save changes" : "Add resource"}
          </button>
        </div>
      </form>
    </div>
  );
}
