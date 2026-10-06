export type Status =
  | "Available"
  | "Confirmed"
  | "Pending"
  | "Cancelled"
  | "Unavailable"
  | "Active"
  | "Inactive";

type StatusBadgeProps = {
  status: Status;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
