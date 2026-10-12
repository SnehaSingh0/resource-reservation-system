import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge, type Status } from "../../components/StatusBadge";

type Resource = {
  id: number;
  is_active: boolean;
};

type Reservation = {
  id: number;
  user_email: string;
  resource_name: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  created_at: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

type Admin = {
  id: number;
};

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayStatus(status: Reservation["status"]): Status {
  return status === "CONFIRMED"
    ? "Confirmed"
    : status === "PENDING"
      ? "Pending"
      : "Cancelled";
}

export function AdminDashboardPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [adminCount, setAdminCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const [nextResources, nextReservations, admins] = await Promise.all([
          adminApi<Resource[]>("/resources/", {}, "Could not load resources."),
          adminApi<Reservation[]>("/admin/reservations/", {}, "Could not load reservations."),
          adminApi<Admin[]>("/admins/", {}, "Could not load administrators."),
        ]);
        if (!active) return;
        setResources(nextResources);
        setReservations(nextReservations);
        setAdminCount(admins.length);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the administration overview.",
        );
        setResources([]);
        setReservations([]);
        setAdminCount(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const activeReservations = reservations.filter(
    (reservation) => reservation.status !== "CANCELLED",
  );
  const metrics = [
    { label: "Total resources", value: resources.length },
    {
      label: "Active resources",
      value: resources.filter((resource) => resource.is_active).length,
    },
    { label: "Active reservations", value: activeReservations.length },
    {
      label: "Today's reservations",
      value: activeReservations.filter(
        (reservation) => reservation.reservation_date === todayKey,
      ).length,
    },
  ];
  const recentReservations = [...reservations]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 3);

  return (
    <div className="content-stack">
      <PageHeading
        title="Admin Dashboard"
        description="Manage reservations, resources, and administrator access."
      />

      {error && (
        <div className="inline-notice inline-notice-error" role="alert">
          {error}
        </div>
      )}

      <section className="admin-metric-grid" aria-label="System overview">
        {metrics.map((metric) => (
          <article className="admin-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{loading || error ? "—" : metric.value}</strong>
          </article>
        ))}
      </section>

      <nav className="admin-quick-links" aria-label="Administration shortcuts">
        <Link className="button button-secondary" to="/admin/reservations">
          Manage reservations
        </Link>
        <Link className="button button-secondary" to="/admin/resources">
          Manage resources
        </Link>
        <Link className="button button-secondary" to="/admin/admins">
          Manage admins ({loading || adminCount === null ? "—" : adminCount})
        </Link>
      </nav>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent reservations</h2>
            <p>A quick view of the latest booking activity.</p>
          </div>
          <Link className="text-link" to="/admin/reservations">
            View all
          </Link>
        </div>
        {loading ? (
          <div className="inline-notice" role="status">
            Loading administration data…
          </div>
        ) : (
          <div className="table-scroll" role="region" aria-label="Recent reservations table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td><strong>{reservation.user_email}</strong></td>
                    <td>{reservation.resource_name}</td>
                    <td>{formatDate(reservation.reservation_date)}</td>
                    <td>{reservation.start_time.slice(0, 5)} – {reservation.end_time.slice(0, 5)}</td>
                    <td><StatusBadge status={displayStatus(reservation.status)} /></td>
                  </tr>
                ))}
                {recentReservations.length === 0 && (
                  <tr>
                    <td className="empty-table" colSpan={5}>
                      No reservation activity is available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
