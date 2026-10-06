import { useNavigate } from "react-router-dom";

type ProfileMenuProps = {
  initials: string;
  profileLabel: string;
};

export function ProfileMenu({ initials, profileLabel }: ProfileMenuProps) {
  const navigate = useNavigate();

  return (
    <details className="profile-menu">
      <summary
        className="user-profile"
        aria-label="Open profile menu"
        title="Profile menu"
      >
        <span className="user-profile-initials">{initials}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="profile-menu-popover">
        <div className="profile-menu-profile">
          <strong>Profile</strong>
          <span>{profileLabel}</span>
        </div>
        <button
          className="profile-menu-logout"
          type="button"
          onClick={() => navigate("/login")}
        >
          Logout
        </button>
      </div>
    </details>
  );
}
