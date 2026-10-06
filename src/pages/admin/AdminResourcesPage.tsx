import { useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { demoResources, type Resource } from "../../data/demoData";

const weekDays = [
  { label: "Sun", day: 0 },
  { label: "Mon", day: 1 },
  { label: "Tue", day: 2 },
  { label: "Wed", day: 3 },
  { label: "Thu", day: 4 },
  { label: "Fri", day: 5 },
  { label: "Sat", day: 6 },
];

function formatAvailability(resource: Resource) {
  return weekDays
    .filter(({ day }) => resource.weeklyAvailability[day])
    .map(({ day, label }) => {
      const availability = resource.weeklyAvailability[day];
      return `${label} ${availability?.startTime}–${availability?.endTime}`;
    })
    .join(" · ");
}

export function AdminResourcesPage() {
  const [resources, setResources] = useState(demoResources);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(
    null,
  );

  function deleteResource() {
    if (!resourceToDelete) return;
    setResources((current) =>
      current.filter((resource) => resource.id !== resourceToDelete.id),
    );
    setResourceToDelete(null);
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Resources"
        description="Set up reservable spaces and equipment."
        action={
          <Link className="button button-primary" to="/admin/resources/add">
            <span aria-hidden="true">＋</span> Add resource
          </Link>
        }
      />
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Resources</h2>
            <p>{resources.length} resources</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
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
              {resources.map((resource) => (
                <tr key={resource.id}>
                  <td>
                    <strong>{resource.name}</strong>
                    <small className="table-subtext">
                      {resource.description}
                    </small>
                  </td>
                  <td>{resource.type}</td>
                  <td>{resource.location}</td>
                  <td>
                    <span className="availability-summary">
                      {formatAvailability(resource) || "No available days"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-badge status-${resource.status.toLowerCase()}`}
                    >
                      <span className="status-dot" aria-hidden="true" />
                      {resource.status}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <Link
                        className="table-action"
                        to={`/admin/resources/edit?resourceId=${encodeURIComponent(resource.id)}`}
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
            </tbody>
          </table>
        </div>
      </section>

      {resourceToDelete && (
        <ConfirmDialog
          title="Remove this resource?"
          message={`Remove ${resourceToDelete.name} from this demo list? No saved data will be changed.`}
          confirmLabel="Remove resource"
          onCancel={() => setResourceToDelete(null)}
          onConfirm={deleteResource}
        />
      )}
    </div>
  );
}
