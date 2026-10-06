import { Link } from "react-router-dom";
import { PagePlaceholder } from "../components/PagePlaceholder";

export function NotFoundPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <PagePlaceholder
          title="Page not found"
          description="The address does not match a page in this application."
        />
        <p className="auth-switch">
          <Link to="/resources">Return to reservations</Link>
        </p>
      </section>
    </main>
  );
}
