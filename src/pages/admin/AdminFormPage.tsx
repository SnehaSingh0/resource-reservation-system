import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { PageHeading } from "../../components/PageHeading";

type ManagedAdmin = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: "ADMIN" | "USER";
};

type AdminFields = {
  fullName: string;
  email: string;
  phone: string;
  role: "ADMIN" | "USER";
};

const emptyFields: AdminFields = {
  fullName: "",
  email: "",
  phone: "",
  role: "USER",
};

export function AdminFormPage({ mode = "add" }: { mode?: "add" | "edit" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editing = mode === "edit";
  const adminId = searchParams.get("adminId");
  const [fields, setFields] = useState(emptyFields);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) return;
    let active = true;
    async function loadAdmin() {
      if (!adminId || !/^\d+$/.test(adminId)) {
        setError("A valid administrator must be selected for editing.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const admin = await adminApi<ManagedAdmin>(
          `/admins/${adminId}/`,
          {},
          "Could not load the administrator.",
        );
        if (active) {
          setFields({
            fullName: `${admin.first_name} ${admin.last_name}`.trim(),
            email: admin.email,
            phone: admin.phone ?? "",
            role: admin.role,
          });
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error
            ? loadError.message
            : "Could not load the administrator.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadAdmin();
    return () => {
      active = false;
    };
  }, [adminId, editing]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const [firstName = "", ...lastNameParts] = fields.fullName.trim().split(/\s+/);
    if (!firstName) {
      setError("Full name is required.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    setSaving(true);
    try {
      const account = await adminApi<ManagedAdmin>(
        editing ? `/admins/${adminId}/` : "/users/",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastNameParts.join(" "),
            email: fields.email.trim(),
            phone: fields.phone.trim(),
            ...(!editing ? { role: fields.role, password } : {}),
          }),
        },
        editing
          ? "Could not update the administrator."
          : "Could not create the user account.",
      );
      navigate("/admin/admins", {
        state: {
          notice: `${`${account.first_name} ${account.last_name}`.trim() || account.email} was ${
            editing ? "updated" : "added"
          } as ${account.role === "ADMIN" ? "an admin" : "a user"}.`,
        },
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : editing
            ? "Could not update the administrator."
            : "Could not create the user account.",
      );
    } finally {
      setSaving(false);
    }
  }

  function updateField(field: keyof AdminFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="content-stack">
      <PageHeading title={editing ? "Edit Admin" : "Add User"} />
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      {loading ? (
        <div className="inline-notice" role="status">Loading administrator…</div>
      ) : (
        <form className="panel resource-form-panel" onSubmit={(event) => void handleSubmit(event)}>
          <div className="form-grid">
            <label className="form-control form-grid-full">
              <span>Full name</span>
              <input
                name="fullName"
                placeholder="Enter full name"
                required
                value={fields.fullName}
                onChange={(event) => updateField("fullName", event.target.value)}
              />
            </label>
            <label className="form-control form-grid-full">
              <span>Email address</span>
              <input
                type="email"
                name="email"
                placeholder="name@example.com"
                required
                value={fields.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </label>
            <label className="form-control form-grid-full">
              <span>Phone</span>
              <input
                name="phone"
                value={fields.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </label>
            {!editing && (
              <label className="form-control form-grid-full">
                <span>Role</span>
                <select
                  name="role"
                  value={fields.role}
                  onChange={(event) => {
                    const role = event.target.value;
                    if (role === "ADMIN" || role === "USER") {
                      updateField("role", role);
                    }
                  }}
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
            )}
            {!editing && (
              <label className="form-control form-grid-full">
                <span>Temporary password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
          </div>
          {!editing && (
            <p className="form-helper">
              Django validates and securely hashes the password. Share the temporary password through a secure channel.
            </p>
          )}
          <div className="form-actions">
            <Link className="button button-secondary" to="/admin/admins">Cancel</Link>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add User"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
