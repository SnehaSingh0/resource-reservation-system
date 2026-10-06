type AuthBrandProps = {
  className?: string;
};

export function AuthBrand({ className }: AuthBrandProps) {
  return (
    <div
      className={["app-brand", className].filter(Boolean).join(" ")}
      aria-label="Resource Reservation System"
    >
      <svg className="app-brand-mark" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2" y="2" width="7" height="7" rx="1.5" />
        <rect x="11" y="2" width="7" height="7" rx="1.5" />
        <rect x="2" y="11" width="7" height="7" rx="1.5" />
        <rect x="11" y="11" width="7" height="7" rx="1.5" />
      </svg>
      <span>Resource Reservation System</span>
    </div>
  );
}
