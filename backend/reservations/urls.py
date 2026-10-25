from django.urls import path

from .views import (
    AdminListCreateView,
    AdminDetailView,
    AdminReservationDeleteView,
    AdminReservationListView,
    CurrentUserView,
    CsrfTokenView,
    LoginView,
    LogoutView,
    RegisterUserView,
    ResourceAvailabilityView,
    ResourceConstraintBulkListView,
    ResourceConstraintDetailView,
    ResourceConstraintListCreateView,
    ResourceDetailView,
    ResourceListCreateView,
    ReservationDetailView,
    ReservationListCreateView,
    TemporaryPasswordVerificationDiagnosticView,
    UserListView,
)

urlpatterns = [
    path("auth/register/", RegisterUserView.as_view(), name="auth-register"),
    path("auth/csrf/", CsrfTokenView.as_view(), name="auth-csrf"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    # Temporary: remove this route and import, then delete its view after investigation.
    path(
        "auth/temporary-password-diagnostic/",
        TemporaryPasswordVerificationDiagnosticView.as_view(),
        name="temporary-password-diagnostic",
    ),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("users/me/", CurrentUserView.as_view(), name="user-me"),
    path("users/", UserListView.as_view(), name="user-list"),
    path("resources/", ResourceListCreateView.as_view(), name="resource-list-create"),
    path(
        "resources/constraints/",
        ResourceConstraintBulkListView.as_view(),
        name="resource-constraints-bulk",
    ),
    path("resources/<int:pk>/", ResourceDetailView.as_view(), name="resource-detail"),
    path(
        "resources/<int:resource_id>/availability/",
        ResourceAvailabilityView.as_view(),
        name="resource-availability",
    ),
    path(
        "resources/<int:resource_id>/constraints/",
        ResourceConstraintListCreateView.as_view(),
        name="resource-constraints",
    ),
    path(
        "resource-constraints/<int:pk>/",
        ResourceConstraintDetailView.as_view(),
        name="resource-constraint-detail",
    ),
    path("reservations/", ReservationListCreateView.as_view(), name="reservation-list-create"),
    path("reservations/<int:pk>/", ReservationDetailView.as_view(), name="reservation-detail"),
    path("admin/reservations/", AdminReservationListView.as_view(), name="admin-reservations"),
    path(
        "admin/reservations/<int:pk>/",
        AdminReservationDeleteView.as_view(),
        name="admin-reservation-delete",
    ),
    path("admins/", AdminListCreateView.as_view(), name="admins-list-create"),
    path("admins/<int:pk>/", AdminDetailView.as_view(), name="admins-detail"),
]
