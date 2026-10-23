import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { StatusBadge } from "../../components/StatusBadge";
import { apiUrl } from "../../api/apiUrl";
import { requireCsrfToken } from "../../api/csrf";
import { cachedGet, invalidateCachedGets } from "../../api/requestCache";
import { formatReservationTimeline } from "../../utils/reservationTimeline";

type BookingStatus = "Confirmed" | "Pending";

type Booking = {
  id: number | string;
  resourceId: number;
  resource: string;
  timeline: string;
  status: BookingStatus;
};

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
  const [notice, setNotice] = useState("");
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  async function loadReservations() {
    setLoading(true);
    setError("");

    try {
      const reservationsUrl = apiUrl("/reservations/");
      const payload = await cachedGet(
        `${user?.id}:${reservationsUrl}`,
        async () => {
          const response = await fetch(reservationsUrl, {
            credentials: "include",
          });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              throw new Error("Please sign in to view your reservations.");
            }
            throw new Error("Could not load your reservations from the server.");
          }

          return (await response.json()) as Array<{
            id: number;
            resource: number;
            resource_name: string;
            reservation_date: string;
            end_date?: string | null;
            start_time: string | null;
            end_time: string | null;
            is_full_day: boolean;
            status: string;
          }>;
        },
      );

      const nextBookings: Booking[] = (Array.isArray(payload) ? payload : [])
        .filter((reservation) => {
          if (reservation.status === "CANCELLED") return false;
          const endDt = getReservationEndDateTime(
            reservation.reservation_date,
            reservation.end_date,
            reservation.end_time,
            reservation.is_full_day,
          );
          if (endDt === null) return true;
          return endDt.getTime() >= Date.now();
        })
        .map((reservation) => {
          const normalizedStatus: BookingStatus =
            reservation.status === "PENDING" ? "Pending" : "Confirmed";
          return {
            id: reservation.id,
            resourceId: reservation.resource,
            resource: reservation.resource_name,
            timeline: formatReservationTimeline(reservation),
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

      invalidateCachedGets(
        apiUrl("/reservations/"),
        `:${apiUrl("/reservations/")}`,
        apiUrl("/admin/reservations/"),
        apiUrl(`/resources/${bookingToCancel.resourceId}/availability/`),
      );
      setBookings((current) =>
        current.filter((booking) => booking.id !== bookingToCancel.id),
      );
      setBookingToCancel(null);
      setError("");
      setNotice("Reservation cancelled and permanently removed.");
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
    <div className="content-stack my-reservations-page">
      <PageHeading
        title="My Reservations"
      />

      <section className="panel table-panel">
        {error && (
          <div className="inline-notice inline-notice-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="inline-notice" role="status">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="inline-notice" role="status">
            Loading your reservations…
          </div>
        ) : (
          <div className="table-scroll my-reservations-table-scroll" role="region" aria-label="My reservations table" tabIndex={0}>
            <table className="data-table my-reservations-table">
              <thead>
                <tr>
                  <th scope="col">Resource</th>
                  <th scope="col">Reservation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={String(booking.id)}>
                    <td data-label="Resource">
                      <strong>{booking.resource}</strong>
                    </td>
                    <td data-label="Reservation">{booking.timeline}</td>
                    <td data-label="Status">
                      <StatusBadge status={booking.status} />
                    </td>
                    <td data-label="Actions">
                      <button
                        className="table-action table-action-danger"
                        type="button"
                        disabled={isCancelling}
                        onClick={() => setBookingToCancel(booking)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr>
                    <td className="empty-table" colSpan={4}>
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
          message={`Permanently cancel and remove your reservation for ${bookingToCancel.resource}? This cannot be undone.`}
          confirmLabel="Cancel booking"
          onCancel={() => setBookingToCancel(null)}
          onConfirm={cancelBooking}
        />
      )}
    </div>
  );
}
