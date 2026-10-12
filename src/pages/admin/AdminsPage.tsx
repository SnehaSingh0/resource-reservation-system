import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { adminApi } from "../../api/adminApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";

type Admin = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
};

function adminName(admin: Admin) {
  return `${admin.first_name} ${admin.last_name}`.trim() || admin.email;
}

export function AdminsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
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
      setAdmins(await adminApi<Admin[]>("/admins/", {}, "Could not load administrators."));
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
        "Could not delete this administrator.",
      );
      const deletedName = adminName(adminToDelete);
      setAdminToDelete(null);
      setNotice(`${deletedName} was removed from the administrator accounts.`);
      await loadAdmins();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete this administrator.",
      );
      setAdminToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="content-stack">
      <PageHeading
        title="Manage Admins"
        description="Manage administrator access to this application."
        action={
          <Link className="button button-primary" to="/admin/admins/add">
            <span aria-hidden="true">＋</span> Add admin
          </Link>
        }
      />
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {error && <div className="inline-notice inline-notice-error" role="alert">{error}</div>}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Administrators</h2>
            <p>{loading ? "Loading…" : `${admins.length} administrators`}</p>
          </div>
        </div>
        <div className="table-scroll" role="region" aria-label="Administrators table" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr><th scope="col">Administrator</th><th scope="col">Email address</th><th scope="col">Role</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {!loading && admins.map((admin) => (
                <tr key={admin.id}>
                  <td><strong>{adminName(admin)}</strong></td>
                  <td>{admin.email}</td>
                  <td><span className="role-chip">Administrator</span></td>
                  <td>
                    {admin.id === user?.id ? (
                      <span className="table-muted-action">Current account</span>
                    ) : (
                      <button
                        className="table-action table-action-danger"
                        type="button"
                        onClick={() => setAdminToDelete(admin)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {loading && <tr><td className="empty-table" colSpan={4}>Loading administrators…</td></tr>}
              {!loading && admins.length === 0 && (
                <tr><td className="empty-table" colSpan={4}>No administrator accounts are available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {adminToDelete && (
        <ConfirmDialog
          title="Delete administrator?"
          message={`Remove ${adminName(adminToDelete)}'s administrator account? The last active administrator and the account currently in use cannot be deleted.`}
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
