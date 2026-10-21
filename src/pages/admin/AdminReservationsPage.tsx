import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge, type Status } from "../../components/StatusBadge";
import { formatReservationTimeline } from "../../utils/reservationTimeline";
import { apiUrl } from "../../api/apiUrl";
import { invalidateCachedGets } from "../../api/requestCache";

type Reservation = {
  id: number;
  resource: number;
  user_email: string;
  resource_name: string;
  reservation_date: string;
  end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
};

function displayStatus(status: Reservation["status"]): Status {
  return status === "CONFIRMED"
    ? "Confirmed"
    : status === "PENDING"
      ? "Pending"
      : "Cancelled";
}

export function AdminReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
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
      setReservations(
        result.filter((reservation) => reservation.status !== "CANCELLED"),
      );
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
      invalidateCachedGets(
        apiUrl(`/resources/${reservationToCancel.resource}/availability/`),
      );
      setReservationToCancel(null);
      setNotice(`Reservation ${reservationToCancel.id} was cancelled and removed.`);
      setReservations((current) =>
        current.filter((reservation) => reservation.id !== reservationToCancel.id),
      );
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Could not cancel this reservation.",
      );
      setReservationToCancel(null);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading title="Manage Reservations" />
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Active reservations</h2>
          </div>
        </div>
        <div className="table-scroll" role="region" aria-label="Reservations table" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">User</th><th scope="col">Resource</th><th scope="col">Reservation</th>
                <th scope="col">Status</th><th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && reservations.map((reservation) => {
                return (
                  <tr key={reservation.id}>
                    <td><strong>{reservation.user_email}</strong></td>
                    <td>{reservation.resource_name}</td>
                    <td>{formatReservationTimeline(reservation)}</td>
                    <td><StatusBadge status={displayStatus(reservation.status)} /></td>
                    <td>
                      {reservation.status !== "CANCELLED" ? (
                        <button
                          className="table-action table-action-danger"
                          type="button"
                          onClick={() => setReservationToCancel(reservation)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="table-muted-action">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {loading && <tr><td className="empty-table" colSpan={5}>Loading reservations…</td></tr>}
              {!loading && reservations.length === 0 && (
                <tr><td className="empty-table" colSpan={5}>No active reservations found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reservationToCancel && (
        <ConfirmDialog
          title="Cancel this reservation?"
          message={`Permanently cancel and remove ${reservationToCancel.user_email}'s reservation for ${reservationToCancel.resource_name}? This cannot be undone.`}
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
