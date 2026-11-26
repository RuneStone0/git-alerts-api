from django.urls import path

from .views import ProgramView, ProgramDetailsView

urlpatterns = [
    path("programs/", ProgramView.as_view(), name="program"),
    path("programs/<slug:slug>/", ProgramDetailsView.as_view(), name="program-details"),
]
