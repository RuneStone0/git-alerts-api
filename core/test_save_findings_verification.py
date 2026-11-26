"""save_findings must record the scanner's verdict, and must not undo a human's mark.

Regression: `validated` was never written by the scan path, so the `--only-verified` setting
could not be observed after the fact. The second assertion is the guard against the obvious
over-correction, where a later unverified scan clears a verification a person set by hand.

Runs in the image's Django (pytest-django, which this host does not have).
"""
import pytest
from django.contrib.auth import get_user_model

from core.services.scan_orchestrator import ScanOrchestrator
from findings.models import Finding
from scans.models import Scan


def _finding(detector, raw, verified):
    return {
        "repository": "https://github.com/acme/app",
        "commit": "abc123",
        "file": "config.txt",
        "line": 3,
        "author": "dev@acme.test",
        "type": detector,
        "description": f"{detector} key",
        "value": raw,
        "verified": verified,
    }


def _orchestrator(scan):
    # save_findings only touches self.scan and self.should_ignore_finding, so the rest of the
    # constructor (GitHub token, system settings) is irrelevant to this test.
    orch = ScanOrchestrator.__new__(ScanOrchestrator)
    orch.scan = scan
    orch.should_ignore_finding = lambda finding: False
    return orch


@pytest.mark.django_db
def test_a_trusted_verified_finding_is_marked_validated():
    user = get_user_model().objects.create_user(username="t", password="t")
    scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    _orchestrator(scan).save_findings(
        "https://github.com/acme/app", [_finding("Stripe", "sk_live_x", True)]
    )
    assert Finding.objects.get().validated is True


@pytest.mark.django_db
def test_an_explorer_detector_stays_unvalidated_even_when_the_scanner_says_verified():
    user = get_user_model().objects.create_user(username="t", password="t")
    scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    _orchestrator(scan).save_findings(
        "https://github.com/acme/app",
        [_finding("BscScan", "81Y3M1IIMMBTT1ND7TY1MHD5EGP4T59WP7", True)],
    )
    assert Finding.objects.get().validated is False


@pytest.mark.django_db
def test_a_later_unverified_scan_does_not_clear_a_human_verification():
    user = get_user_model().objects.create_user(username="t", password="t")
    scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    orch = _orchestrator(scan)
    orch.save_findings("https://github.com/acme/app", [_finding("Stripe", "sk_live_x", False)])
    finding = Finding.objects.get()
    finding.validated = True          # a person confirmed it by hand
    finding.save(update_fields=["validated"])

    orch.save_findings("https://github.com/acme/app", [_finding("Stripe", "sk_live_x", False)])
    assert Finding.objects.get().validated is True


@pytest.mark.django_db
def test_the_same_secret_in_a_second_commit_keeps_one_row():
    """One secret in one place: a second commit holding the same value is a sighting, not a row.

    The commit hash has to stay on the first row, because that row's fingerprint already names
    it; only the scan pointer moves to the scan that saw it last.
    """
    user = get_user_model().objects.create_user(username="t", password="***")
    first_scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    original = _finding("Unsplash", "W4Wy-test-access-key", False)
    _orchestrator(first_scan).save_findings("https://github.com/acme/app", [original])

    second_scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    later = dict(original, commit="def456", line=9)
    _orchestrator(second_scan).save_findings("https://github.com/acme/app", [later])

    assert Finding.objects.count() == 1
    row = Finding.objects.get()
    assert row.commit_hash == "abc123"
    assert row.line == 3
    assert row.scan_id == second_scan.id


@pytest.mark.django_db
def test_a_different_secret_in_the_same_file_is_still_a_second_row():
    user = get_user_model().objects.create_user(username="t", password="***")
    scan = Scan.objects.create(user=user, type=Scan.ScanTypes.ORG_REPOS, value="acme")
    _orchestrator(scan).save_findings(
        "https://github.com/acme/app",
        [_finding("Unsplash", "W4Wy-one", False), _finding("SonarCloud", "W4Wy-two", False)],
    )
    assert Finding.objects.count() == 2
