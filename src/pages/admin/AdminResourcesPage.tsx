import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
  is_active: boolean;
};

const weekdays = [
  { label: "Sun", day: 6 },
  { label: "Mon", day: 0 },
  { label: "Tue", day: 1 },
  { label: "Wed", day: 2 },
  { label: "Thu", day: 3 },
  { label: "Fri", day: 4 },
  { label: "Sat", day: 5 },
];

function formatTime(value: string) {
  return value.slice(0, 5);
}

function formatAvailability(
  resource: Resource,
  constraints: Constraint[] | undefined,
) {
  if (constraints === undefined) return "Availability unavailable";
  if (constraints.length === 0) {
    return `Every day ${formatTime(resource.default_start_time)}–${formatTime(resource.default_end_time)}`;
  }
  return weekdays
    .map(({ day, label }) => {
      const windows = constraints
        .filter((constraint) => constraint.day_of_week === day && constraint.is_active)
        .sort((left, right) => left.start_time.localeCompare(right.start_time));
      if (!windows.length) return null;
      return windows
        .map(
          (window) =>
            `${label} ${formatTime(window.start_time)}–${formatTime(window.end_time)}`,
        )
        .join(", ");
    })
    .filter((value): value is string => value !== null)
    .join(" · ") || "No available days";
}

export function AdminResourcesPage() {
  const location = useLocation();
  const [resources, setResources] = useState<Resource[]>([]);
  const [constraintsByResource, setConstraintsByResource] = useState<
    Record<number, Constraint[]>
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
      const nextResources = await adminApi<Resource[]>("/resources/", {}, "Could not load resources.");
      const constraintEntries = await Promise.all(
        nextResources.map(async (resource) => [
          resource.id,
          await adminApi<Constraint[]>(
            `/resources/${resource.id}/constraints/`,
            {},
            `Could not load availability for ${resource.name}.`,
          ),
        ] as const),
      );
      setResources(nextResources);
      setConstraintsByResource(Object.fromEntries(constraintEntries));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load resources.",
      );
      setResources([]);
      setConstraintsByResource({});
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
      await loadResources();
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
        description="Set up reservable spaces and equipment."
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
        <div className="table-scroll" role="region" aria-label="Resources table" tabIndex={0}>
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
              {!loading && resources.map((resource) => (
                <tr key={resource.id}>
                  <td>
                    <strong>{resource.name}</strong>
                    <small className="table-subtext">{resource.description}</small>
                  </td>
                  <td>{resource.resource_type}</td>
                  <td>{resource.location || "—"}</td>
                  <td>
                    <span className="availability-summary">
                      {formatAvailability(resource, constraintsByResource[resource.id])}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge status-${resource.is_active ? "active" : "inactive"}`}>
                      <span className="status-dot" aria-hidden="true" />
                      {resource.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
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
          message={`Permanently delete ${resourceToDelete.name}? Resources with reservation history cannot be deleted; deactivate those resources instead.`}
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
