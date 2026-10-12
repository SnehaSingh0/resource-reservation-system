import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { PageHeading } from "../../components/PageHeading";

export function AdminFormPage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") ?? "").trim();
    if (!fullName) {
      setError("Full name is required.");
      setSaving(false);
      return;
    }
    const [firstName = "", ...lastNameParts] = fullName.split(/\s+/);
    try {
      const created = await adminApi<{ first_name: string; last_name: string; email: string }>(
        "/admins/",
        {
          method: "POST",
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastNameParts.join(" "),
            email: String(form.get("email") ?? "").trim(),
            password: String(form.get("password") ?? ""),
          }),
        },
        "Could not create the administrator account.",
      );
      navigate("/admin/admins", {
        state: { notice: `${`${created.first_name} ${created.last_name}`.trim() || created.email} was added as an administrator.` },
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not create the administrator account.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading title="Add Admin" description="Add an administrator to the application." />
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      <form className="panel resource-form-panel" onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-grid">
          <label className="form-control form-grid-full">
            <span>Full name</span>
            <input name="fullName" placeholder="Enter full name" required />
          </label>
          <label className="form-control form-grid-full">
            <span>Email address</span>
            <input type="email" name="email" placeholder="name@example.com" required />
          </label>
          <label className="form-control form-grid-full">
            <span>Temporary password</span>
            <input type="password" name="password" autoComplete="new-password" required />
          </label>
        </div>
        <p className="form-helper">
          Django validates and securely hashes the password. Share the temporary password through a secure channel.
        </p>
        <div className="form-actions">
          <Link className="button button-secondary" to="/admin/admins">Cancel</Link>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Creating…" : "Add admin"}
          </button>
        </div>
      </form>
    </div>
  );
}
