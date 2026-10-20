import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, PublicOnlyRoute, RequireAuth } from "../auth/AuthContext";
import { AdminLayout } from "../layouts/AdminLayout";
import { UserLayout } from "../layouts/UserLayout";

const AdminDashboardPage = lazy(() =>
  import("../pages/admin/AdminDashboardPage").then((module) => ({
    default: module.AdminDashboardPage,
  })),
);
const AdminFormPage = lazy(() =>
  import("../pages/admin/AdminFormPage").then((module) => ({
    default: module.AdminFormPage,
  })),
);
const AdminReservationsPage = lazy(() =>
  import("../pages/admin/AdminReservationsPage").then((module) => ({
    default: module.AdminReservationsPage,
  })),
);
const AdminResourcesPage = lazy(() =>
  import("../pages/admin/AdminResourcesPage").then((module) => ({
    default: module.AdminResourcesPage,
  })),
);
const AdminsPage = lazy(() =>
  import("../pages/admin/AdminsPage").then((module) => ({
    default: module.AdminsPage,
  })),
);
const ResourceFormPage = lazy(() =>
  import("../pages/admin/ResourceFormPage").then((module) => ({
    default: module.ResourceFormPage,
  })),
);
const LoginPage = lazy(() =>
  import("../pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then((module) => ({
    default: module.NotFoundPage,
  })),
);
const RegistrationPage = lazy(() =>
  import("../pages/RegistrationPage").then((module) => ({
    default: module.RegistrationPage,
  })),
);
const MyReservationsPage = lazy(() =>
  import("../pages/user/MyReservationsPage").then((module) => ({
    default: module.MyReservationsPage,
  })),
);
const ResourcesPage = lazy(() =>
  import("../pages/user/ResourcesPage").then((module) => ({
    default: module.ResourcesPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../pages/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense
          fallback={
            <div className="content-stack" role="status">
              <div className="inline-notice">Loading page…</div>
            </div>
          }
        >
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <RegistrationPage />
              </PublicOnlyRoute>
            }
          />

          <Route
            element={
              <RequireAuth>
                <UserLayout />
              </RequireAuth>
            }
          >
            <Route
              path="/dashboard"
              element={<Navigate to="/resources" replace />}
            />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/my-reservations" element={<MyReservationsPage />} />
            <Route
              path="/user/reservation"
              element={<Navigate to="/resources" replace />}
            />
            <Route
              path="/user/bookings"
              element={<Navigate to="/my-reservations" replace />}
            />
          </Route>

          <Route
            element={
              <RequireAuth requireAdmin>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/resources" element={<AdminResourcesPage />} />
            <Route
              path="/admin/resources/add"
              element={<ResourceFormPage mode="add" />}
            />
            <Route
              path="/admin/resources/edit"
              element={<ResourceFormPage mode="edit" />}
            />
            <Route path="/admin/reservations" element={<AdminReservationsPage />} />
            <Route path="/admin/admins" element={<AdminsPage />} />
            <Route path="/admin/admins/add" element={<AdminFormPage />} />
            <Route
              path="/admin/admins/edit"
              element={<AdminFormPage mode="edit" />}
            />
            <Route
              path="/admin/users"
              element={<Navigate to="/admin/admins" replace />}
            />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
