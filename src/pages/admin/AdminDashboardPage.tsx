import { Link } from "react-router-dom";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge } from "../../components/StatusBadge";
import { demoAdmins, demoReservations, demoResources } from "../../data/demoData";
import { getSessionReservations } from "../../data/demoSessionReservations";

export function AdminDashboardPage() {
  const reservations = [...demoReservations, ...getSessionReservations()];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const metrics = [
    { label: "Total resources", value: demoResources.length },
    {
      label: "Available resources",
      value: demoResources.filter(
        (resource) =>
          resource.status === "Active" &&
          resource.weeklyAvailability[today.getDay()] !== null,
      ).length,
    },
    {
      label: "Active reservations",
      value: reservations.filter((reservation) => reservation.status !== "Cancelled")
        .length,
    },
    {
      label: "Today's reservations",
      value: reservations.filter(
        (reservation) =>
          reservation.date === todayKey && reservation.status !== "Cancelled",
      ).length,
    },
  ];

  return (
    <div className="content-stack">
      <PageHeading
        title="Admin Dashboard"
        description="Manage reservations, resources, and administrator access."
      />

      <section className="admin-metric-grid" aria-label="System overview">
        {metrics.map((metric) => (
          <article className="admin-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
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
          Manage admins ({demoAdmins.length})
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
        <div className="table-scroll">
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
              {reservations
                .slice(-3)
                .reverse()
                .map((reservation) => (
                <tr key={reservation.id}>
                  <td><strong>{reservation.user}</strong></td>
                  <td>{reservation.resource}</td>
                  <td>{reservation.date}</td>
                  <td>{reservation.startTime} – {reservation.endTime}</td>
                  <td><StatusBadge status={reservation.status} /></td>
                </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
