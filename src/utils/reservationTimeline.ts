type ReservationTimeline = {
  reservation_date: string;
  end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
};

function formatShortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatFullDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string | null) {
  return value?.slice(0, 5) ?? "—";
}

export function formatReservationTimeline(reservation: ReservationTimeline) {
  const endDate = reservation.end_date || reservation.reservation_date;
  if (reservation.reservation_date === endDate) {
    const period = reservation.is_full_day
      ? "Full Day"
      : `${formatTime(reservation.start_time)}–${formatTime(reservation.end_time)}`;
    return `${formatFullDate(reservation.reservation_date)} • ${period}`;
  }

  if (reservation.is_full_day) {
    return `${formatShortDate(reservation.reservation_date)} – ${formatShortDate(endDate)} • Full Day`;
  }

  return `${formatShortDate(reservation.reservation_date)}, ${formatTime(reservation.start_time)} → ${formatShortDate(endDate)}, ${formatTime(reservation.end_time)}`;
}
