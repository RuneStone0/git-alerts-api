"""Tests for run_scan_task's preflight handling.

Regression: one transient DNS failure during a concurrent scan marked the shared GitHub
integration FAILED. Nothing cleared it, and the scan serializer refuses to create scans
unless the integration is CONNECTED, so a single blip blocked every later scan.
"""
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth.models import User

from integrations.models import UserIntegration
from scans.models import Scan
from scans.tasks import run_scan_task

pytestmark = pytest.mark.django_db

NETWORK_ERROR = "Network error: Failed to resolve 'api.github.com'"


@pytest.fixture
def user():
    return User.objects.create_user("rune", "rune@local", "not-a-real-secret")


def make_integration(user, status=UserIntegration.Status.CONNECTED, error_message=""):
    return UserIntegration.objects.create(
        user=user,
        provider=UserIntegration.Provider.GITHUB,
        status=status,
        token_encrypted="",
        error_message=error_message,
    )


def make_scan(user):
    return Scan.objects.create(
        user=user, type=Scan.ScanTypes.ORG_REPOS, value="23andMe",
        status=Scan.ScanStatus.QUEUED,
    )


def run_with_preflight(scan, validation_result, get_token="fake-token"):
    """Run the task with the network and the scanner stubbed out."""
    with patch.object(UserIntegration, "get_token", return_value=get_token), \
         patch("scans.tasks.validate_github_integration", return_value=validation_result), \
         patch("scans.tasks.GitHubClient"), \
         patch("scans.tasks.TruffleHogClient"), \
         patch("scans.tasks.ScanOrchestrator"):
        run_scan_task(scan.id)


def test_successful_preflight_clears_a_stale_failure(user):
    integration = make_integration(
        user, status=UserIntegration.Status.FAILED, error_message=NETWORK_ERROR
    )
    scan = make_scan(user)

    run_with_preflight(scan, (True, ""))

    integration.refresh_from_db()
    scan.refresh_from_db()
    assert integration.status == UserIntegration.Status.CONNECTED
    assert integration.error_message == ""
    assert scan.status == Scan.ScanStatus.COMPLETED


def test_network_failure_fails_the_scan_but_keeps_the_integration_connected(user):
    integration = make_integration(user)
    scan = make_scan(user)

    with pytest.raises(ValueError):
        run_with_preflight(scan, (False, NETWORK_ERROR))

    integration.refresh_from_db()
    scan.refresh_from_db()
    assert integration.status == UserIntegration.Status.CONNECTED
    assert scan.status == Scan.ScanStatus.FAILED
    assert scan.error_message == NETWORK_ERROR


def test_network_failure_does_not_rewrite_a_previously_good_error_message(user):
    integration = make_integration(user)
    scan = make_scan(user)

    with pytest.raises(ValueError):
        run_with_preflight(scan, (False, NETWORK_ERROR))

    integration.refresh_from_db()
    assert integration.error_message == ""


def test_rejected_token_marks_the_integration_failed_and_records_why(user):
    integration = make_integration(user)
    scan = make_scan(user)

    with pytest.raises(ValueError):
        run_with_preflight(scan, (False, "Token is invalid or expired"))

    integration.refresh_from_db()
    scan.refresh_from_db()
    assert integration.status == UserIntegration.Status.FAILED
    assert integration.error_message == "Token is invalid or expired"
    assert scan.status == Scan.ScanStatus.FAILED
    assert scan.error_message == "Token is invalid or expired"


def test_orchestrator_crash_records_the_exception_on_the_scan(user):
    make_integration(user)
    scan = make_scan(user)

    with patch.object(UserIntegration, "get_token", return_value="fake-token"), \
         patch("scans.tasks.validate_github_integration", return_value=(True, "")), \
         patch("scans.tasks.GitHubClient"), \
         patch("scans.tasks.TruffleHogClient"), \
         patch("scans.tasks.ScanOrchestrator") as orchestrator:
        orchestrator.return_value.run.side_effect = RuntimeError("trufflehog exploded")
        with pytest.raises(RuntimeError):
            run_scan_task(scan.id)

    scan.refresh_from_db()
    assert scan.status == Scan.ScanStatus.FAILED
    assert scan.error_message == "RuntimeError: trufflehog exploded"


def test_an_auth_error_mid_scan_fails_both_the_integration_and_the_scan(user):
    """A 401 from GitHub after a passing preflight means the token died mid-scan.

    The scan keeps a sentence a human can act on, and the integration is marked FAILED so the
    serializer stops queuing new scans against a dead token.
    """
    from core.clients.github_client import GitHubAuthError
    from core.services.scan_orchestrator import ScanOrchestrator

    integration = make_integration(user)
    scan = make_scan(user)
    orchestrator = MagicMock()
    orchestrator.run.side_effect = GitHubAuthError("bad credentials")

    with patch.object(UserIntegration, "get_token", return_value="fake-token"), \
         patch("scans.tasks.validate_github_integration", return_value=(True, "")), \
         patch("scans.tasks.GitHubClient"), \
         patch("scans.tasks.TruffleHogClient"), \
         patch("scans.tasks.ScanOrchestrator", return_value=orchestrator):
        with pytest.raises(GitHubAuthError):
            run_scan_task(scan.id)

    integration.refresh_from_db()
    scan.refresh_from_db()
    assert integration.status == UserIntegration.Status.FAILED
    assert integration.error_message == "GitHub token is invalid or expired"
    assert scan.status == Scan.ScanStatus.FAILED
    assert scan.error_message == "GitHub token is invalid or expired"
