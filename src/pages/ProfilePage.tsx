import { useAuth } from "../auth/AuthContext";
import { PageHeading } from "../components/PageHeading";

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return (
    <main className="profile-page">
      <PageHeading
        title="Profile"
        description="View your account details and assigned access role."
      />
      <section className="panel profile-details" aria-label="Account details">
        <dl>
          <div><dt>Name</dt><dd>{fullName || "Not provided"}</dd></div>
          <div><dt>Email address</dt><dd>{user.email}</dd></div>
          <div><dt>Role</dt><dd>{user.role === "ADMIN" ? "Administrator" : "User"}</dd></div>
          {user.phone && <div><dt>Phone</dt><dd>{user.phone}</dd></div>}
        </dl>
      </section>
    </main>
  );
}
