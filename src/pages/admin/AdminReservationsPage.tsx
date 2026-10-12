import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge, type Status } from "../../components/StatusBadge";

type Reservation = {
  id: number;
  user_email: string;
  resource_name: string;
  reservation_date: string;
  start_time: string;
  end_time: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

function displayStatus(status: Reservation["status"]): Status {
  return status === "CONFIRMED"
    ? "Confirmed"
    : status === "PENDING"
      ? "Pending"
      : "Cancelled";
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AdminReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [reservationToCancel, setReservationToCancel] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadReservations() {
    setLoading(true);
    setError("");
    try {
      const result = await adminApi<Reservation[]>(
        "/admin/reservations/",
        {},
        "Could not load reservations.",
      );
      setReservations(result);
    } catch (loadError) {
      setReservations([]);
      setError(
        loadError instanceof Error ? loadError.message : "Could not load reservations.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReservations();
  }, []);

  async function cancelReservation() {
    if (!reservationToCancel) return;
    setCancelling(true);
    setError("");
    setNotice("");
    try {
      await adminApi<void>(
        `/admin/reservations/${reservationToCancel.id}/`,
        { method: "DELETE" },
        "Could not cancel this reservation.",
      );
      setReservationToCancel(null);
      setNotice(`Reservation ${reservationToCancel.id} was cancelled. Its history remains available.`);
      await loadReservations();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Could not cancel this reservation.",
      );
      setReservationToCancel(null);
    } finally {
      setCancelling(false);
    }
  }

  const visibleReservations =
    statusFilter === "all"
      ? reservations
      : reservations.filter((reservation) => reservation.status.toLowerCase() === statusFilter);

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Reservations"
        description="Review and manage resource reservations."
      />
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>All reservations</h2>
            <p>{loading ? "Loading…" : `${visibleReservations.length} reservations shown`}</p>
          </div>
          <label className="compact-select">
            <span className="visually-hidden">Filter reservations</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All reservations</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <div className="table-scroll" role="region" aria-label="Reservations table" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">User</th><th scope="col">Resource</th><th scope="col">Date</th>
                <th scope="col">Start time</th><th scope="col">End time</th><th scope="col">Status</th><th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleReservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td><strong>{reservation.user_email}</strong><small className="table-subtext">{reservation.id}</small></td>
                  <td>{reservation.resource_name}</td>
                  <td>{formatDate(reservation.reservation_date)}</td>
                  <td>{reservation.start_time.slice(0, 5)}</td>
                  <td>{reservation.end_time.slice(0, 5)}</td>
                  <td><StatusBadge status={displayStatus(reservation.status)} /></td>
                  <td>
                    {reservation.status !== "CANCELLED" ? (
                      <button className="table-action table-action-danger" type="button" onClick={() => setReservationToCancel(reservation)}>
                        Cancel
                      </button>
                    ) : <span className="table-muted-action">—</span>}
                  </td>
                </tr>
              ))}
              {loading && <tr><td className="empty-table" colSpan={7}>Loading reservations…</td></tr>}
              {!loading && visibleReservations.length === 0 && (
                <tr><td className="empty-table" colSpan={7}>No reservations match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reservationToCancel && (
        <ConfirmDialog
          title="Cancel this reservation?"
          message={`Cancel ${reservationToCancel.user_email}'s reservation for ${reservationToCancel.resource_name}? The reservation record will be retained with a cancelled status.`}
          confirmLabel={cancelling ? "Cancelling…" : "Cancel reservation"}
          onCancel={() => {
            if (!cancelling) setReservationToCancel(null);
          }}
          onConfirm={() => void cancelReservation()}
        />
      )}
    </div>
  );
}
