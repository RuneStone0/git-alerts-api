"""The submission trail: a finding remembers that it was sent, and when.

`report_status`/`reported_at` are the human's record, deliberately separate from `validated` (the
scanner's verdict). The drawer writes both in one PATCH so they cannot disagree, and undoing the
mark has to clear the date too, or a row reads "not reported" while still carrying a sent date.
"""

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from findings.models import Finding
from scans.models import Scan


def make_finding(user) -> Finding:
    scan = Scan.objects.create(
        user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme",
        status=Scan.ScanStatus.COMPLETED,
    )
    return Finding.objects.create(
        scan=scan, repository="acme/repo", type="PrivateKey", value="secret-value",
        file="key.pem", email="a@b.c", commit_hash="abc123",
    )


@pytest.mark.django_db
def test_patch_records_the_submission_and_its_date():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)
    client = APIClient()
    client.force_authenticate(user=user)

    sent_at = "2026-11-26T05:00:00Z"
    resp = client.patch(
        f"/findings/{finding.id}/",
        {"report_status": "reported", "reported_at": sent_at},
        format="json",
    )

    assert resp.status_code == 200
    finding.refresh_from_db()
    assert finding.report_status == "reported"
    assert finding.reported_at is not None
    assert resp.data["report_status"] == "reported"


@pytest.mark.django_db
def test_clearing_the_submission_clears_the_date():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)
    finding.report_status = "reported"
    client = APIClient()
    client.force_authenticate(user=user)
    client.patch(
        f"/findings/{finding.id}/",
        {"report_status": "reported", "reported_at": "2026-11-26T05:00:00Z"},
        format="json",
    )

    resp = client.patch(
        f"/findings/{finding.id}/", {"report_status": "", "reported_at": None}, format="json"
    )

    assert resp.status_code == 200
    finding.refresh_from_db()
    assert finding.report_status == ""
    assert finding.reported_at is None


@pytest.mark.django_db
def test_the_trail_is_the_only_writable_part_of_a_finding():
    """Everything the scanner recorded stays read-only, or a PATCH could rewrite evidence."""
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.patch(
        f"/findings/{finding.id}/",
        {"repository": "someone/else", "value": "rewritten", "report_status": "reported"},
        format="json",
    )

    assert resp.status_code == 200
    finding.refresh_from_db()
    assert finding.repository == "acme/repo"
    assert finding.value == "secret-value"
    assert finding.report_status == "reported"
