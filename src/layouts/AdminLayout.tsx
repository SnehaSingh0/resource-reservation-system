import { NavLink, Outlet } from "react-router-dom";
import { AuthBrand } from "../components/AuthBrand";
import { ProfileMenu } from "../components/ProfileMenu";

type AdminIconName = "dashboard" | "reservations" | "resources" | "admins";

const adminNavigation = [
  { label: "Dashboard", to: "/admin", end: true, icon: "dashboard" },
  { label: "Reservations", to: "/admin/reservations", icon: "reservations" },
  { label: "Resources", to: "/admin/resources", icon: "resources" },
  { label: "Admins", to: "/admin/admins", icon: "admins" },
] as const;

function AdminNavigationIcon({ name }: { name: AdminIconName }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {name === "dashboard" && (
        <>
          <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
        </>
      )}
      {name === "reservations" && (
        <>
          <rect x="3" y="4" width="14" height="13" rx="1.5" />
          <path d="M6.5 2.5v3M13.5 2.5v3M3 8h14M6 11h2m3 0h3m-8 3h2" />
        </>
      )}
      {name === "resources" && (
        <>
          <rect x="3" y="3" width="14" height="14" rx="1.5" />
          <path d="M7 3v14M3 8h14" />
        </>
      )}
      {name === "admins" && (
        <>
          <circle cx="10" cy="6.5" r="3" />
          <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
        </>
      )}
    </svg>
  );
}

export function AdminLayout() {
  return (
    <div className="admin-app-shell">
      <aside className="admin-sidebar">
        <NavLink className="admin-brand-link" to="/admin">
          <AuthBrand className="admin-brand" />
        </NavLink>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="admin-navigation" aria-label="Admin navigation">
          {adminNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : undefined}
              className={({ isActive }) =>
                isActive ? "admin-navigation-link active" : "admin-navigation-link"
              }
            >
              <span className="admin-navigation-icon" aria-hidden="true">
                <AdminNavigationIcon name={item.icon} />
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink className="admin-navigation-link" to="/resources">
            <span className="admin-navigation-icon external-link-icon" aria-hidden="true">↗</span>
            User area
          </NavLink>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>Resource Reservation System</span>
          <div className="admin-topbar-actions">
            <span className="topbar-context">Admin workspace</span>
            <ProfileMenu initials="AD" profileLabel="Administrator" />
          </div>
        </header>
        <main className="admin-page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
