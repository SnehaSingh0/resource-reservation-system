import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge } from "../../components/StatusBadge";
import {
  getSessionReservations,
  saveSessionReservations,
} from "../../data/demoSessionReservations";

type Booking = {
  id: string;
  resource: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "Confirmed" | "Pending" | "Cancelled";
};

const initialBookings: Booking[] = [
  {
    id: "RS-1052",
    resource: "Meeting Room 1",
    date: "Oct 7, 2026",
    startTime: "10:00 AM",
    endTime: "11:00 AM",
    status: "Confirmed",
  },
  {
    id: "RS-1054",
    resource: "Projector 1",
    date: "Oct 9, 2026",
    startTime: "1:00 PM",
    endTime: "3:00 PM",
    status: "Pending",
  },
];

export function MyReservationsPage() {
  const [sessionReservations, setSessionReservations] =
    useState(getSessionReservations);
  const [bookings, setBookings] = useState<Booking[]>(() => [
    ...initialBookings,
    ...sessionReservations.map((reservation) => ({
      id: reservation.id,
      resource: reservation.resource,
      date: new Date(`${reservation.date}T12:00:00`).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" },
      ),
      startTime: new Date(`2026-01-01T${reservation.startTime}`).toLocaleTimeString(
        "en-US",
        { hour: "numeric", minute: "2-digit" },
      ),
      endTime: new Date(`2026-01-01T${reservation.endTime}`).toLocaleTimeString(
        "en-US",
        { hour: "numeric", minute: "2-digit" },
      ),
      status: reservation.status,
    })),
  ]);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);

  function cancelBooking() {
    if (!bookingToCancel) return;
    setBookings((current) =>
      current.map((booking) =>
        booking.id === bookingToCancel.id
          ? { ...booking, status: "Cancelled" }
          : booking,
      ),
    );
    if (
      sessionReservations.some(
        (reservation) => reservation.id === bookingToCancel.id,
      )
    ) {
      const updatedSessionReservations = sessionReservations.map((reservation) =>
        reservation.id === bookingToCancel.id
          ? { ...reservation, status: "Cancelled" as const }
          : reservation,
      );
      saveSessionReservations(updatedSessionReservations);
      setSessionReservations(updatedSessionReservations);
    }
    setBookingToCancel(null);
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="My Reservations"
        description="Review and manage your resource reservations."
      />

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Reservations</h2>
            <p>{bookings.length} reservations</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Date</th>
                <th scope="col">Start time</th>
                <th scope="col">End time</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    <strong>{booking.resource}</strong>
                    <small className="table-subtext">{booking.id}</small>
                  </td>
                  <td>{booking.date}</td>
                  <td>{booking.startTime}</td>
                  <td>{booking.endTime}</td>
                  <td><StatusBadge status={booking.status} /></td>
                  <td>
                    {booking.status !== "Cancelled" ? (
                      <button
                        className="table-action table-action-danger"
                        type="button"
                        onClick={() => setBookingToCancel(booking)}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="table-muted-action">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr>
                  <td className="empty-table" colSpan={6}>
                    No reservations are available in this demo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {bookingToCancel && (
        <ConfirmDialog
          title="Cancel this booking?"
          message={`Cancel your reservation for ${bookingToCancel.resource} on ${bookingToCancel.date}? This change is temporary and only lasts for this browser session.`}
          confirmLabel="Cancel booking"
          onCancel={() => setBookingToCancel(null)}
          onConfirm={cancelBooking}
        />
      )}
    </div>
  );
}
