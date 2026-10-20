import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge, type Status } from "../../components/StatusBadge";
import { formatReservationTimeline } from "../../utils/reservationTimeline";

type Resource = {
  id: number;
  is_active: boolean;
};

type Reservation = {
  id: number;
  user_email: string;
  resource_name: string;
  reservation_date: string;
  end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  created_at: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

type User = {
  id: number;
};

function displayStatus(status: Reservation["status"]): Status {
  return status === "CONFIRMED"
    ? "Confirmed"
    : status === "PENDING"
      ? "Pending"
      : "Cancelled";
}

export function AdminDashboardPage() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [adminCount, setAdminCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      setLoading(true);
      setError("");
      const results = await Promise.allSettled([
        adminApi<Resource[]>("/resources/", {}, "Could not load resources."),
        adminApi<Reservation[]>("/admin/reservations/", {}, "Could not load reservations."),
        adminApi<User[]>("/admins/", {}, "Could not load administrators."),
      ]);
      if (!active) return;

      const errors: string[] = [];
      if (results[0].status === "fulfilled") {
        setResources(results[0].value);
      } else {
        setResources(null);
        errors.push("Could not load resources.");
      }
      if (results[1].status === "fulfilled") {
        setReservations(results[1].value);
      } else {
        setReservations(null);
        errors.push("Could not load reservations.");
      }
      if (results[2].status === "fulfilled") {
        setAdminCount(results[2].value.length);
      } else {
        setAdminCount(null);
        errors.push("Could not load administrators.");
      }
      setError(errors.join(" "));
      setLoading(false);
    }
    void loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const activeReservations = (reservations ?? []).filter(
    (reservation) => reservation.status !== "CANCELLED",
  );
  const metrics = [
    { label: "Total resources", value: resources?.length ?? null },
    {
      label: "Active resources",
      value: resources?.filter((resource) => resource.is_active).length ?? null,
    },
    {
      label: "Active reservations",
      value: reservations === null ? null : activeReservations.length,
    },
    {
      label: "Today's reservations",
      value: reservations === null
        ? null
        : activeReservations.filter(
            (reservation) =>
              reservation.reservation_date <= todayKey &&
              (reservation.end_date || reservation.reservation_date) >= todayKey,
          ).length,
    },
  ];
  const recentReservations = [...(reservations ?? [])]
    .filter((reservation) => reservation.status !== "CANCELLED")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 3);

  return (
    <div className="content-stack">
      <PageHeading
        title="Admin Dashboard"
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
            <strong>{loading || metric.value === null ? "—" : metric.value}</strong>
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
          Manage users ({loading || adminCount === null ? "—" : adminCount})
        </Link>
      </nav>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent reservations</h2>
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
                  <th scope="col">Reservation</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td><strong>{reservation.user_email}</strong></td>
                    <td>{reservation.resource_name}</td>
                    <td>{formatReservationTimeline(reservation)}</td>
                    <td><StatusBadge status={displayStatus(reservation.status)} /></td>
                  </tr>
                ))}
                {recentReservations.length === 0 && (
                  <tr>
                    <td className="empty-table" colSpan={4}>
                      {reservations === null
                        ? "Recent reservations could not be loaded."
                        : "No reservation activity is available."}
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
