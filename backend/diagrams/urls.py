from django.urls import path

from .views import (
    CurrentUserView,
    CsrfTokenView,
    DiagramDetailView,
    DiagramDuplicateView,
    DiagramGraphView,
    DiagramListCreateView,
    LoginView,
    LogoutView,
    RegistrationView,
)

urlpatterns = [
    path("csrf/", CsrfTokenView.as_view(), name="csrf-token"),
    path("auth/register/", RegistrationView.as_view(), name="register"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
    path("diagrams/", DiagramListCreateView.as_view(), name="diagram-list"),
    path("diagrams/<uuid:diagram_id>/", DiagramDetailView.as_view(), name="diagram-detail"),
    path(
        "diagrams/<uuid:diagram_id>/duplicate/",
        DiagramDuplicateView.as_view(),
        name="diagram-duplicate",
    ),
    path(
        "diagrams/<uuid:diagram_id>/graph/",
        DiagramGraphView.as_view(),
        name="diagram-graph",
    ),
]
