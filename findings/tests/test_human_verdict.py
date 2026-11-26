"""A human's claim about a verdict: recorded on the finding, never written into the verdict.

The claim is three-way on purpose. A detector error, someone else's credential and a real finding
this programme cannot receive are different corrections, and a single "false positive" flag would
report the scanner as wrong on rows where it was right.

Two invariants this file protects:
  * a claim needs a reason from its own vocabulary, so one click cannot mean two things
  * the date follows the claim: clearing it clears the reason, the note and the stamp
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
        scan=scan, repository="acme/repo", type="Infura", value="project-id",
        file="app.js", email="a@b.c", commit_hash="abc123",
    )


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_patch_records_a_claim_with_its_reason_and_date():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)

    resp = client_for(user).patch(
        f"/findings/{finding.id}/",
        {"human_verdict": "not_ours", "human_reason": "upstream_inherited",
         "human_note": "commit exists in the parent"},
        format="json",
    )

    assert resp.status_code == 200
    finding.refresh_from_db()
    assert finding.human_verdict == "not_ours"
    assert finding.human_reason == "upstream_inherited"
    assert finding.human_note == "commit exists in the parent"
    assert finding.human_at is not None, "the date is stamped server-side"
    assert resp.data["human_verdict"] == "not_ours"


@pytest.mark.django_db
def test_a_claim_without_a_reason_is_refused():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)

    resp = client_for(user).patch(
        f"/findings/{finding.id}/", {"human_verdict": "detector_wrong"}, format="json",
    )

    assert resp.status_code == 400
    assert "human_reason" in resp.data


@pytest.mark.django_db
def test_a_reason_from_another_verdict_is_refused():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)

    resp = client_for(user).patch(
        f"/findings/{finding.id}/",
        {"human_verdict": "detector_wrong", "human_reason": "upstream_inherited"},
        format="json",
    )

    assert resp.status_code == 400
    assert "human_reason" in resp.data


@pytest.mark.django_db
def test_clearing_the_claim_clears_reason_note_and_date():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)
    client = client_for(user)
    client.patch(
        f"/findings/{finding.id}/",
        {"human_verdict": "not_reportable", "human_reason": "live_not_eligible",
         "human_note": "nuxt only"},
        format="json",
    )

    resp = client.patch(f"/findings/{finding.id}/", {"human_verdict": ""}, format="json")

    assert resp.status_code == 200
    finding.refresh_from_db()
    assert finding.human_verdict == ""
    assert finding.human_reason == ""
    assert finding.human_note == ""
    assert finding.human_at is None


@pytest.mark.django_db
def test_the_claim_is_readable_on_the_list_without_the_secret():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    finding = make_finding(user)
    finding.human_verdict = "detector_wrong"
    finding.human_reason = "scanner_fixture"
    finding.save()

    resp = client_for(user).get("/findings/?page_size=5")

    assert resp.status_code == 200
    row = resp.data["results"][0]
    assert row["human_verdict"] == "detector_wrong"
    assert "value" not in row
