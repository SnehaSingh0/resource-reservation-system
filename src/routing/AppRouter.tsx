import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegistrationPage />} />

        <Route element={<UserLayout />}>
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

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="resources" element={<AdminResourcesPage />} />
          <Route
            path="resources/add"
            element={<ResourceFormPage mode="add" />}
          />
          <Route
            path="resources/edit"
            element={<ResourceFormPage mode="edit" />}
          />
          <Route path="reservations" element={<AdminReservationsPage />} />
          <Route path="admins" element={<AdminsPage />} />
          <Route path="admins/add" element={<AdminFormPage />} />
          <Route
            path="users"
            element={<Navigate to="/admin/admins" replace />}
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
