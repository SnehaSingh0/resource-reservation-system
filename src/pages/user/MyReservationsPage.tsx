import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge } from "../../components/StatusBadge";
import { apiUrl } from "../../api/apiUrl";
import { requireCsrfToken } from "../../api/csrf";

type BookingStatus = "Confirmed" | "Pending" | "Cancelled";
// Cancelled is a valid display status — cancelled reservations are shown so the user
// can confirm their cancellation was recorded.

type Booking = {
  id: number | string;
  resource: string;
  date: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
};

function formatDisplayDate(dateValue: string) {
  if (!dateValue) return "—";
  return new Date(`${dateValue}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDisplayTime(timeValue: string) {
  if (!timeValue) return "—";
  return new Date(`2026-01-01T${timeValue}`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getReservationEndDateTime(
  date: string,
  endDate: string | null | undefined,
  endTime: string | null,
  isFullDay: boolean,
): Date | null {
  const effectiveEndDate = endDate || date;
  if (isFullDay) {
    return new Date(`${effectiveEndDate}T23:59:59`);
  }
  // Guard: if end_time is null for a timed booking, we cannot determine when it ends.
  // Return null so the caller can decide how to handle it rather than produce Invalid Date.
  if (!endTime) {
    return null;
  }
  return new Date(`${effectiveEndDate}T${endTime}`);
}

export function MyReservationsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  async function loadReservations() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(apiUrl("/reservations/"), {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Please sign in to view your reservations.");
        }
        throw new Error("Could not load your reservations from the server.");
      }

      const payload = (await response.json()) as Array<{
        id: number;
        resource_name: string;
        reservation_date: string;
        end_date?: string | null;
        start_time: string | null;
        end_time: string | null;
        is_full_day: boolean;
        status: string;
      }>;

      const nextBookings: Booking[] = (Array.isArray(payload) ? payload : [])
        .filter((reservation) => {
          // Always show cancelled reservations so users can confirm their cancellation was recorded.
          if (reservation.status === "CANCELLED") return true;
          // For active/pending reservations, hide ones that have already ended.
          const endDt = getReservationEndDateTime(
            reservation.reservation_date,
            reservation.end_date,
            reservation.end_time,
            reservation.is_full_day,
          );
          // If end time cannot be determined (null end_time on a timed booking), show it
          // rather than silently dropping it — the user should be aware of it.
          if (endDt === null) return true;
          return endDt.getTime() >= Date.now();
        })
        .map((reservation) => {
          const normalizedStatus: BookingStatus =
            reservation.status === "CANCELLED"
              ? "Cancelled"
              : reservation.status === "PENDING"
                ? "Pending"
                : "Confirmed";
          const startDate = formatDisplayDate(reservation.reservation_date);
          const endDate = reservation.end_date ? formatDisplayDate(reservation.end_date) : startDate;
          return {
            id: reservation.id,
            resource: reservation.resource_name,
            date:
              reservation.end_date && reservation.end_date !== reservation.reservation_date
                ? `${startDate} – ${endDate}`
                : startDate,
            startTime: reservation.is_full_day
              ? "All day"
              : formatDisplayTime(reservation.start_time ?? ""),
            endTime: reservation.is_full_day
              ? "All day"
              : formatDisplayTime(reservation.end_time ?? ""),
            status: normalizedStatus,
          };
        });

      setBookings(nextBookings);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Could not load your reservations from the server.";
      setError(message);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) {
      void loadReservations();
    }
  }, [user?.id]);

  async function cancelBooking() {
    if (!bookingToCancel || isCancelling) return;

    setIsCancelling(true);
    try {
      const csrfToken = await requireCsrfToken();
      const response = await fetch(apiUrl(`/reservations/${bookingToCancel.id}/`), {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail || "Could not cancel this reservation.");
      }

      setBookings((current) =>
        current.filter((booking) => booking.id !== bookingToCancel.id),
      );
      setBookingToCancel(null);
      setError("");
    } catch (cancelError) {
      const message =
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel this reservation.";
      setError(message);
      setBookingToCancel(null);
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="My Reservations"
      />

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Upcoming reservations</h2>
          </div>
        </div>

        {error && (
          <div className="inline-notice inline-notice-error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="inline-notice" role="status">
            Loading your reservations…
          </div>
        ) : (
          <div className="table-scroll" role="region" aria-label="My reservations table" tabIndex={0}>
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
                  <tr key={String(booking.id)}>
                    <td>
                      <strong>{booking.resource}</strong>
                    </td>
                    <td>{booking.date}</td>
                    <td>{booking.startTime}</td>
                    <td>{booking.endTime}</td>
                    <td>
                      <StatusBadge status={booking.status} />
                    </td>
                    <td>
                      {booking.status !== "Cancelled" ? (
                        <button
                          className="table-action table-action-danger"
                          type="button"
                          disabled={isCancelling}
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
                      No reservations are available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bookingToCancel && (
        <ConfirmDialog
          title="Cancel this booking?"
          message={`Cancel your reservation for ${bookingToCancel.resource} on ${bookingToCancel.date}?`}
          confirmLabel="Cancel booking"
          onCancel={() => setBookingToCancel(null)}
          onConfirm={cancelBooking}
        />
      )}
    </div>
  );
}
