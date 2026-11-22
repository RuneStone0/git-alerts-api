"""Tests for the findings list view's optional pagination.

This is the crash fix: the browser paginates /findings/ with ?page= and gets a bounded
{count, results} envelope, while the resolver and scan factory keep reading the full bare
list. Both shapes must keep working together.
"""

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from findings.models import Finding
from scans.models import Scan


@pytest.mark.django_db
def make_findings(user, n):
    scan = Scan.objects.create(
        user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme",
        status=Scan.ScanStatus.COMPLETED,
    )
    for i in range(n):
        Finding.objects.create(
            scan=scan, repository=f"acme/repo{i}", type="PrivateKey", value=f"secret-{i}",
            file="key.pem", email="a@b.c", commit_hash="abc123",
        )
    return scan


@pytest.mark.django_db
def test_findings_list_is_a_bare_list_without_page():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    make_findings(user, 55)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/findings/")

    assert resp.status_code == 200
    assert isinstance(resp.data, list)
    assert len(resp.data) == 55


@pytest.mark.django_db
def test_findings_list_paginates_when_page_is_requested():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    make_findings(user, 55)

    client = APIClient()
    client.force_authenticate(user=user)

    page1 = client.get("/findings/?page=1")
    assert page1.status_code == 200
    assert isinstance(page1.data, dict)
    assert page1.data["count"] == 55
    assert len(page1.data["results"]) == 50
    assert page1.data["next"] is not None

    page2 = client.get("/findings/?page=2")
    assert page2.status_code == 200
    assert len(page2.data["results"]) == 5
    assert page2.data["previous"] is not None
    assert page2.data["next"] is None


@pytest.mark.django_db
def test_findings_page_size_is_bounded():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    make_findings(user, 10)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/findings/?page=1&page_size=1000")  # capped at max_page_size=200

    assert resp.status_code == 200
    assert len(resp.data["results"]) == 10  # fewer rows than the cap, so all of them
