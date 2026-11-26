"""The route table and the bootstrap contract, pinned.

A URL that stops resolving is the cheapest outage to ship and the slowest to notice: nginx falls
back to index.html for unknown paths, so the SPA still loads and one panel is silently empty (or
worse, reads an HTML page as JSON). These tests resolve every path the UI calls, so a renamed
include or a deleted urlpattern fails here instead of in a browser.
"""

import pytest
from django.urls import resolve
from rest_framework.test import APIClient

# Every path the UI or the scan factory calls, with the name the project gives it. Keep this list
# in step with App.tsx (SPA routes) and services/api.ts (API calls).
EXPECTED_ROUTES = [
    ("/", "home"),
    ("/scans/", "scan"),
    ("/scans/1/", "scan-details"),
    ("/scans/1/findings/", "scan-findings"),
    ("/findings/", "finding"),
    ("/findings/1/", "finding-details"),
    ("/programs/", "program"),
    ("/programs/example/", "program-details"),
    ("/integrations/", "integration"),
    ("/integrations/1/validate/", "integration-validate"),
    ("/settings/", "settings"),
    ("/api/config/", "instance-config"),
    ("/api/token/", "token_obtain_pair"),
    ("/api/token/refresh/", "token_refresh"),
    ("/finding-ignores/types/", "ignore-type"),
    ("/finding-ignores/domains/", "ignore-domain"),
]


@pytest.mark.parametrize("path,name", EXPECTED_ROUTES)
def test_route_resolves_to_its_name(path, name):
    match = resolve(path)
    assert match.url_name == name, f"{path} resolved to {match.url_name!r}"


def local_user():
    """The principal an open-mode deployment authenticates every request as.

    A fresh test database has no user rows, and LocalUserAuthentication raises
    AuthenticationFailed when `AUTH_MODE=open` has nobody to be, which surfaces as a 403 on
    endpoints that would otherwise answer. So a test that calls the stack has to create it.
    """
    from django.contrib.auth.models import User

    return User.objects.create_superuser("rune", "rune@local", "not-a-real-secret")


@pytest.mark.django_db
def test_home_reports_the_api_version_and_health():
    """The UI and the smoke tests both read this as the liveness probe."""
    local_user()
    resp = APIClient().get("/")

    assert resp.status_code == 200
    assert resp.data["status"] == "healthy"
    assert resp.data["name"] == "GitAlerts API"
    assert resp.data["version"]


@pytest.mark.django_db
def test_instance_config_bootstraps_the_ui_without_credentials():
    """The UI calls this before it has a session; a 401 here is a blank screen."""
    local_user()
    resp = APIClient().get("/api/config/")

    assert resp.status_code == 200
    assert resp.data["auth_mode"] in ("open", "login")
    assert "local_user" in resp.data
