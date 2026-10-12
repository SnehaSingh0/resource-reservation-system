import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, PublicOnlyRoute, RequireAuth } from "../auth/AuthContext";
import { AdminLayout } from "../layouts/AdminLayout";
import { UserLayout } from "../layouts/UserLayout";
import { AdminDashboardPage } from "../pages/admin/AdminDashboardPage";
import { AdminFormPage } from "../pages/admin/AdminFormPage";
import { AdminReservationsPage } from "../pages/admin/AdminReservationsPage";
import { AdminResourcesPage } from "../pages/admin/AdminResourcesPage";
import { AdminsPage } from "../pages/admin/AdminsPage";
import { ResourceFormPage } from "../pages/admin/ResourceFormPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RegistrationPage } from "../pages/RegistrationPage";
import { MyReservationsPage } from "../pages/user/MyReservationsPage";
import { ResourcesPage } from "../pages/user/ResourcesPage";
import { ProfilePage } from "../pages/ProfilePage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
              path="/admin/users"
              element={<Navigate to="/admin/admins" replace />}
            />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
