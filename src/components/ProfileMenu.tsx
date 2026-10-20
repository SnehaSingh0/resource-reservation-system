import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function getDisplayName(firstName: string, lastName: string, email: string) {
  return `${firstName} ${lastName}`.trim() || email;
}

function getInitials(firstName: string, lastName: string, role: "ADMIN" | "USER") {
  const name = `${firstName} ${lastName}`.trim();
  if (!name) return role === "ADMIN" ? "A" : "U";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ProfileMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  if (!user) return null;

  const displayName = getDisplayName(user.first_name, user.last_name, user.email);
  const roleLabel = user.role === "ADMIN" ? "Administrator" : "User";
  const initials = getInitials(user.first_name, user.last_name, user.role);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      setLogoutError(
        error instanceof Error
          ? error.message
          : "Could not end your session. Please try again.",
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
  }

  return (
    <details
      className="profile-menu"
      ref={menuRef}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") closeMenu();
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        closeMenu();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuRef.current?.open) {
          closeMenu();
          menuRef.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className="user-profile"
        aria-label={`Open profile menu for ${displayName}, ${roleLabel}`}
        title="Profile menu"
      >
        <span className="user-profile-initials" aria-hidden="true">{initials}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="profile-menu-popover">
        <div className="profile-menu-profile">
          <strong>{displayName}</strong>
          <span>{roleLabel}</span>
        </div>
        <Link className="profile-menu-link" to="/profile" onClick={closeMenu}>
          Profile
        </Link>
        {user.role === "ADMIN" && (
          <>
            <Link className="profile-menu-link" to="/resources" onClick={closeMenu}>
              User Area
            </Link>
            <Link className="profile-menu-link" to="/admin" onClick={closeMenu}>
              Admin Area
            </Link>
          </>
        )}
        {logoutError && <p className="auth-error" role="alert">{logoutError}</p>}
        <button
          className="profile-menu-logout"
          type="button"
          disabled={isLoggingOut}
          onClick={() => void handleLogout()}
        >
          {isLoggingOut ? "Logging out…" : "Logout"}
        </button>
      </div>
    </details>
  );
}
