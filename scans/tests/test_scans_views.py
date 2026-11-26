"""Scans API: creation rules, ownership, and what a scan's findings endpoint exposes.

`ScanSerializer.validate` is the gate that stops a scan from being queued while the GitHub
integration is missing or broken, and it also refuses a duplicate of a live target. Both refusals
are the difference between "queued" and "silently does nothing", so they are pinned here, together
with the ownership scoping every scan route relies on.
"""

from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from findings.models import Finding
from integrations.models import UserIntegration
from scans.models import Scan


def make_user(name="rune"):
    return User.objects.create_user(name, f"{name}@local", "not-a-real-secret")


def connect_github(user, status=UserIntegration.Status.CONNECTED):
    integration = UserIntegration.objects.create(user=user, provider="github", status=status)
    integration.set_token("valid-token-123456")
    integration.save()
    return integration


def make_scan(user, **kwargs):
    defaults = dict(type=Scan.ScanTypes.ORG_REPOS, value="acme")
    defaults.update(kwargs)
    return Scan.objects.create(user=user, **defaults)


@pytest.mark.django_db
def test_a_scan_without_a_connected_integration_is_refused():
    user = make_user()
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post("/scans/", {"type": "org_repos", "value": "acme"}, format="json")

    assert resp.status_code == 400
    assert "integration" in str(resp.data)
    assert Scan.objects.count() == 0


@pytest.mark.django_db
def test_a_scan_with_a_failed_integration_is_refused():
    user = make_user()
    connect_github(user, status=UserIntegration.Status.FAILED)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post("/scans/", {"type": "org_repos", "value": "acme"}, format="json")

    assert resp.status_code == 400
    assert Scan.objects.count() == 0


@pytest.mark.django_db
def test_a_scan_is_created_and_queued_for_the_worker():
    user = make_user()
    connect_github(user)
    client = APIClient()
    client.force_authenticate(user=user)

    with patch("scans.views.run_scan_task.delay") as delay:
        resp = client.post("/scans/", {"type": "org_repos", "value": "acme"}, format="json")

    assert resp.status_code == 201
    scan = Scan.objects.get()
    assert scan.user == user
    assert scan.status == Scan.ScanStatus.QUEUED
    delay.assert_called_once_with(scan.id)


@pytest.mark.django_db
def test_a_second_live_scan_of_the_same_target_is_refused():
    user = make_user()
    connect_github(user)
    make_scan(user, status=Scan.ScanStatus.INPROGRESS)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post("/scans/", {"type": "org_repos", "value": "acme"}, format="json")

    assert resp.status_code == 400
    assert Scan.objects.count() == 1


@pytest.mark.django_db
def test_the_same_target_may_be_scanned_again_once_it_finished():
    user = make_user()
    connect_github(user)
    make_scan(user, status=Scan.ScanStatus.COMPLETED)
    client = APIClient()
    client.force_authenticate(user=user)

    with patch("scans.views.run_scan_task.delay"):
        resp = client.post("/scans/", {"type": "org_repos", "value": "acme"}, format="json")

    assert resp.status_code == 201
    assert Scan.objects.count() == 2


@pytest.mark.django_db
def test_the_list_and_detail_are_scoped_to_you():
    mine, theirs = make_user("rune"), make_user("someone")
    my_scan = make_scan(mine)
    foreign = make_scan(theirs)
    client = APIClient()
    client.force_authenticate(user=mine)

    listing = client.get("/scans/")
    assert [row["id"] for row in listing.data] == [my_scan.id]

    assert client.get(f"/scans/{my_scan.id}/").status_code == 200
    assert client.get(f"/scans/{foreign.id}/").status_code == 404


@pytest.mark.django_db
def test_deleting_a_scan_keeps_its_findings():
    user = make_user()
    scan = make_scan(user, status=Scan.ScanStatus.COMPLETED)
    Finding.objects.create(
        scan=scan, repository="acme/app", type="Stripe", value="sk_live_x",
        file="a.py", email="a@b.c", commit_hash="abc",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.delete(f"/scans/{scan.id}/").status_code == 204
    assert Finding.objects.count() == 1


@pytest.mark.django_db
def test_a_scans_findings_keep_the_secret_out_of_the_list():
    user = make_user()
    scan = make_scan(user, status=Scan.ScanStatus.COMPLETED)
    Finding.objects.create(
        scan=scan, repository="acme/app", type="Stripe", value="sk_live_secret",
        file="a.py", email="a@b.c", commit_hash="abc",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    plain = client.get(f"/scans/{scan.id}/findings/")
    with_value = client.get(f"/scans/{scan.id}/findings/?include_value=1")

    assert isinstance(plain.data, list)
    assert "value" not in plain.data[0] and plain.data[0]["value_length"] == len("sk_live_secret")
    assert with_value.data[0]["value"] == "sk_live_secret"


@pytest.mark.django_db
def test_findings_of_someone_elses_scan_are_not_readable():
    mine, theirs = make_user("rune"), make_user("someone")
    foreign = make_scan(theirs)
    client = APIClient()
    client.force_authenticate(user=mine)

    assert client.get(f"/scans/{foreign.id}/findings/").status_code == 404
