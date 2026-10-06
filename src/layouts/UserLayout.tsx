import { NavLink, Outlet } from "react-router-dom";
import { AuthBrand } from "../components/AuthBrand";
import { ProfileMenu } from "../components/ProfileMenu";

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
        <div className="user-header-actions">
          <ProfileMenu initials="JD" profileLabel="User account" />
        </div>
      </header>
      <main className="user-page-content">
        <Outlet />
      </main>
    </div>
  );
}
