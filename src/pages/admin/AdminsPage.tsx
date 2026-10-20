import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { adminApi } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";

type ManagedAdmin = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: "ADMIN";
};

function adminName(admin: ManagedAdmin) {
  return `${admin.first_name} ${admin.last_name}`.trim() || admin.email;
}

export function AdminsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [admins, setAdmins] = useState<ManagedAdmin[]>([]);
  const [adminToDelete, setAdminToDelete] = useState<ManagedAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    typeof location.state?.notice === "string" ? location.state.notice : "",
  );

  async function loadAdmins() {
    setLoading(true);
    setError("");
    try {
      setAdmins(await adminApi<ManagedAdmin[]>("/admins/", {}, "Could not load administrators."));
    } catch (loadError) {
      setAdmins([]);
      setError(
        loadError instanceof Error ? loadError.message : "Could not load administrators.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdmins();
  }, []);

  async function deleteAdmin() {
    if (!adminToDelete) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      await adminApi<void>(
        `/admins/${adminToDelete.id}/`,
        { method: "DELETE" },
        "Could not delete this admin.",
      );
      const deletedName = adminName(adminToDelete);
      setAdminToDelete(null);
      setNotice(`${deletedName} was removed from the admins.`);
      setAdmins((current) =>
        current.filter((admin) => admin.id !== adminToDelete.id),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete this admin.",
      );
      setAdminToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Users"
        action={
          <Link className="button button-primary" to="/admin/admins/add">
            <span aria-hidden="true">＋</span> Add User
          </Link>
        }
      />
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Admins</h2>
          </div>
        </div>
        <div className="table-scroll" role="region" aria-label="Admins table" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr><th scope="col">User</th><th scope="col">Email address</th><th scope="col">Role</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {!loading && admins.map((managedAdmin) => (
                <tr key={managedAdmin.id}>
                  <td><strong>{adminName(managedAdmin)}</strong></td>
                  <td>{managedAdmin.email}</td>
                  <td><span className="role-chip">Admin</span></td>
                  <td>
                    <div className="table-actions">
                    <Link
                      className="table-action"
                      to={`/admin/admins/edit?adminId=${managedAdmin.id}`}
                    >
                      Edit
                    </Link>
                    {managedAdmin.id === user?.id ? (
                      <span className="table-muted-action">Current account</span>
                    ) : (
                      <button
                        className="table-action table-action-danger"
                        type="button"
                        onClick={() => setAdminToDelete(managedAdmin)}
                      >
                        Delete admin
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
              {loading && <tr><td className="empty-table" colSpan={4}>Loading admins…</td></tr>}
              {!loading && admins.length === 0 && (
                <tr><td className="empty-table" colSpan={4}>No admins are available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {adminToDelete && (
        <ConfirmDialog
          title="Delete administrator?"
          message={`Remove ${adminName(adminToDelete)}'s admin account? The last active admin and the account currently in use cannot be deleted.`}
          confirmLabel={deleting ? "Deleting…" : "Delete admin"}
          onCancel={() => {
            if (!deleting) setAdminToDelete(null);
          }}
          onConfirm={() => void deleteAdmin()}
        />
      )}
    </div>
  );
}
