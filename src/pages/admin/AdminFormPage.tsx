import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeading } from "../../components/PageHeading";

export function AdminFormPage() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/admin/admins");
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Add Admin"
        description="Add an administrator to the application."
      />
      <form className="panel resource-form-panel" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="form-control form-grid-full">
            <span>Full name</span>
            <input name="fullName" placeholder="Enter full name" required />
          </label>
          <label className="form-control form-grid-full">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              placeholder="name@example.com"
              required
            />
          </label>
        </div>
        <p className="form-helper">
          This frontend-only form does not create an account.
        </p>
        <div className="form-actions">
          <Link className="button button-secondary" to="/admin/admins">
            Cancel
          </Link>
          <button className="button button-primary" type="submit">
            Add admin
          </button>
        </div>
      </form>
    </div>
  );
}
