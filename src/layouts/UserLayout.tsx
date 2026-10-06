import { NavLink, Outlet } from "react-router-dom";
import { AuthBrand } from "../components/AuthBrand";

export function UserLayout() {
  return (
    <div className="user-app-shell">
      <header className="user-site-header">
        <AuthBrand className="user-layout-brand" />
        <nav className="user-navigation" aria-label="User navigation">
          <NavLink
            to="/resources"
            className={({ isActive }) =>
              isActive ? "user-navigation-link active" : "user-navigation-link"
            }
          >
            Reservations
          </NavLink>
          <NavLink
            to="/my-reservations"
            className={({ isActive }) =>
              isActive ? "user-navigation-link active" : "user-navigation-link"
            }
          >
            My Reservations
          </NavLink>
        </nav>
        <button
          className="user-profile"
          type="button"
          aria-label="User profile menu, initials JD"
        >
          <span className="user-profile-initials">JD</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      </header>
      <main className="user-page-content">
        <Outlet />
      </main>
    </div>
  );
}
