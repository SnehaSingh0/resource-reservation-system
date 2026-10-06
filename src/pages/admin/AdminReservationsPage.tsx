import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge } from "../../components/StatusBadge";
import { demoReservations, type Reservation } from "../../data/demoData";
import {
  getSessionReservations,
  saveSessionReservations,
} from "../../data/demoSessionReservations";

export function AdminReservationsPage() {
  const [sessionReservations, setSessionReservations] =
    useState(getSessionReservations);
  const [reservations, setReservations] = useState(() => [
    ...demoReservations,
    ...sessionReservations,
  ]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [reservationToDelete, setReservationToDelete] =
    useState<Reservation | null>(null);
  const visibleReservations =
    statusFilter === "all"
      ? reservations
      : reservations.filter(
          (reservation) => reservation.status.toLowerCase() === statusFilter,
        );

  function deleteReservation() {
    if (!reservationToDelete) return;
    setReservations((current) =>
      current.filter((reservation) => reservation.id !== reservationToDelete.id),
    );
    const updatedSessionReservations = sessionReservations.filter(
      (reservation) => reservation.id !== reservationToDelete.id,
    );
    if (updatedSessionReservations.length !== sessionReservations.length) {
      saveSessionReservations(updatedSessionReservations);
      setSessionReservations(updatedSessionReservations);
    }
    setReservationToDelete(null);
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Reservations"
        description="Review and manage resource reservations."
      />
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>All reservations</h2>
            <p>{visibleReservations.length} reservations shown</p>
          </div>
          <label className="compact-select">
            <span className="visually-hidden">Filter reservations</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All reservations</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Resource</th>
                <th scope="col">Date</th>
                <th scope="col">Start time</th>
                <th scope="col">End time</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleReservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td>
                    <strong>{reservation.user}</strong>
                    <small className="table-subtext">{reservation.id}</small>
                  </td>
                  <td>{reservation.resource}</td>
                  <td>{reservation.date}</td>
                  <td>{reservation.startTime}</td>
                  <td>{reservation.endTime}</td>
                  <td><StatusBadge status={reservation.status} /></td>
                  <td>
                    <button
                      className="table-action table-action-danger"
                      type="button"
                      onClick={() => setReservationToDelete(reservation)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {visibleReservations.length === 0 && (
                <tr>
                  <td className="empty-table" colSpan={7}>
                    No reservations match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reservationToDelete && (
        <ConfirmDialog
          title="Delete reservation?"
          message={`Delete ${reservationToDelete.user}'s reservation for ${reservationToDelete.resource}? This demo only updates the page.`}
          confirmLabel="Delete reservation"
          onCancel={() => setReservationToDelete(null)}
          onConfirm={deleteReservation}
        />
      )}
    </div>
  );
}
