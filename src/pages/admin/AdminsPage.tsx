import { useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeading } from "../../components/PageHeading";
import { demoAdmins } from "../../data/demoData";

type Admin = (typeof demoAdmins)[number];

export function AdminsPage() {
  const [admins, setAdmins] = useState(demoAdmins);
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);

  function deleteAdmin() {
    if (!adminToDelete) return;
    setAdmins((current) => current.filter((admin) => admin.id !== adminToDelete.id));
    setAdminToDelete(null);
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
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>Administrators</h2>
            <p>{admins.length} administrators</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Administrator</th>
                <th scope="col">Email address</th>
                <th scope="col">Role</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td><strong>{admin.name}</strong></td>
                  <td>{admin.email}</td>
                  <td><span className="role-chip">Administrator</span></td>
                  <td>
                    <button
                      className="table-action table-action-danger"
                      type="button"
                      onClick={() => setAdminToDelete(admin)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {admins.length === 0 && (
                <tr>
                  <td className="empty-table" colSpan={4}>
                    No administrators in this demo list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {adminToDelete && (
        <ConfirmDialog
          title="Delete administrator?"
          message={`Remove ${adminToDelete.name} from the demo administrators list? No account data will be changed.`}
          confirmLabel="Delete admin"
          onCancel={() => setAdminToDelete(null)}
          onConfirm={deleteAdmin}
        />
      )}
    </div>
  );
}
