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


@pytest.mark.django_db
def test_findings_list_never_carries_the_secret():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    make_findings(user, 3)

    client = APIClient()
    client.force_authenticate(user=user)
    rows = client.get("/findings/").data

    assert len(rows) == 3
    for row in rows:
        assert "value" not in row
        assert row["value_length"] == len("secret-0")


@pytest.mark.django_db
def test_scan_findings_list_never_carries_the_secret():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    scan = make_findings(user, 2)

    client = APIClient()
    client.force_authenticate(user=user)
    rows = client.get(f"/scans/{scan.id}/findings/").data

    assert len(rows) == 2
    assert all("value" not in row for row in rows)


@pytest.mark.django_db
def test_findings_detail_carries_the_secret():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    scan = make_findings(user, 1)
    finding = Finding.objects.first()

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get(f"/findings/{finding.id}/")

    assert resp.status_code == 200
    assert resp.data["value"] == "secret-0"


@pytest.mark.django_db
def test_findings_list_returns_value_only_when_explicitly_asked():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    make_findings(user, 2)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.get("/findings/?include_value=1")

    assert resp.status_code == 200
    assert all(row["value"].startswith("secret-") for row in resp.data)

    # and the opt-in survives pagination, which is how the scan factory mirrors findings
    page = client.get("/findings/?include_value=1&page=1&page_size=1")
    assert page.data["results"][0]["value"].startswith("secret-")
