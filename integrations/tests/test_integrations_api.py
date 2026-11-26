"""Integrations: the API surface, the validation task, and the encrypted token round trip.

The task's HTTP helpers are covered in the sibling test_validation.py. What was untested is
everything around them: who can see whose integration, what a create stores, and which of the four
states a validation result leaves behind (connected, failed, unknown provider, and the transient
network error that must NOT overwrite a known-good status).
"""

from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from integrations.models import UserIntegration
from integrations.tasks import run_validation_task, validate_github_integration


def make_user(name="rune"):
    return User.objects.create_user(name, f"{name}@local", "not-a-real-secret")


def make_integration(user, provider=UserIntegration.Provider.GITHUB,
                     status=UserIntegration.Status.CONNECTED, token="valid-token-123456"):
    integration = UserIntegration.objects.create(user=user, provider=provider, status=status)
    integration.set_token(token)
    integration.save()
    return integration


@pytest.mark.django_db
def test_creating_an_integration_stores_an_encrypted_token_and_starts_validation():
    user = make_user()
    client = APIClient()
    client.force_authenticate(user=user)

    with patch("integrations.views.run_validation_task.delay") as delay:
        resp = client.post(
            "/integrations/", {"provider": "github", "token": "ghp_abcdefghijkl"}, format="json"
        )

    assert resp.status_code == 201
    assert "token" not in resp.data          # write-only, never echoed back
    integration = UserIntegration.objects.get(user=user)
    assert integration.token_encrypted != "ghp_abcdefghijkl"
    assert integration.get_token() == "ghp_abcdefghijkl"
    delay.assert_called_once_with(integration.id)


@pytest.mark.django_db
def test_a_short_token_is_rejected_before_it_is_stored():
    user = make_user()
    client = APIClient()
    client.force_authenticate(user=user)

    resp = client.post("/integrations/", {"provider": "github", "token": "short"}, format="json")

    assert resp.status_code == 400
    assert UserIntegration.objects.count() == 0


@pytest.mark.django_db
def test_the_list_only_shows_your_own_integrations():
    mine, theirs = make_user("rune"), make_user("someone")
    make_integration(mine)
    make_integration(theirs, provider=UserIntegration.Provider.SLACK)
    client = APIClient()
    client.force_authenticate(user=mine)

    resp = client.get("/integrations/")

    assert resp.status_code == 200
    assert [row["provider"] for row in resp.data] == ["github"]


@pytest.mark.django_db
def test_revalidating_queues_the_task_and_refuses_someone_elses_row():
    mine, theirs = make_user("rune"), make_user("someone")
    integration = make_integration(mine)
    foreign = make_integration(theirs)
    client = APIClient()
    client.force_authenticate(user=mine)

    with patch("integrations.views.run_validation_task.delay") as delay:
        ok = client.post(f"/integrations/{integration.id}/validate/")
        missing = client.post(f"/integrations/{foreign.id}/validate/")

    assert ok.status_code == 202
    assert ok.data["integration_id"] == integration.id
    assert delay.call_args_list == [((integration.id,), {})]
    assert missing.status_code == 404


@pytest.mark.django_db
def test_validation_marks_a_good_github_token_connected():
    integration = make_integration(make_user(), status=UserIntegration.Status.PENDING)
    with patch("integrations.tasks.validate_github_integration", return_value=(True, "")):
        run_validation_task(integration.id)

    integration.refresh_from_db()
    assert integration.status == UserIntegration.Status.CONNECTED
    assert integration.error_message == ""
    assert integration.last_validated_at is not None


@pytest.mark.django_db
def test_validation_marks_a_rejected_token_failed():
    integration = make_integration(make_user(), status=UserIntegration.Status.PENDING)
    with patch("integrations.tasks.validate_github_integration",
               return_value=(False, "Token is invalid or expired")):
        run_validation_task(integration.id)

    integration.refresh_from_db()
    assert integration.status == UserIntegration.Status.FAILED
    assert integration.error_message == "Token is invalid or expired"


@pytest.mark.django_db
def test_a_network_error_does_not_undo_a_connected_integration():
    integration = make_integration(make_user(), status=UserIntegration.Status.CONNECTED)
    with patch("integrations.tasks.validate_github_integration",
               return_value=(False, "Network error: name resolution")):
        run_validation_task(integration.id)

    integration.refresh_from_db()
    assert integration.status == UserIntegration.Status.CONNECTED
    assert integration.error_message.startswith("Network error")


@pytest.mark.django_db
@pytest.mark.parametrize("provider,valid,expected", [
    (UserIntegration.Provider.SLACK, True, UserIntegration.Status.CONNECTED),
    (UserIntegration.Provider.SLACK, False, UserIntegration.Status.FAILED),
])
def test_slack_validation(provider, valid, expected):
    integration = make_integration(make_user(), provider=provider,
                                   status=UserIntegration.Status.PENDING)
    with patch("integrations.tasks.validate_slack_integration", return_value=valid):
        run_validation_task(integration.id)

    integration.refresh_from_db()
    assert integration.status == expected
    if not valid:
        assert integration.error_message == "Slack token validation failed"


@pytest.mark.django_db
def test_an_unknown_provider_is_reported_rather_than_guessed():
    integration = make_integration(make_user(), provider="bitbucket",
                                   status=UserIntegration.Status.PENDING)

    run_validation_task(integration.id)

    integration.refresh_from_db()
    assert integration.status == UserIntegration.Status.FAILED
    assert integration.error_message == "Unknown provider"


@pytest.mark.django_db
def test_a_vanished_integration_raises_so_celery_can_retry():
    with pytest.raises(UserIntegration.DoesNotExist):
        run_validation_task(999999)


def test_github_validation_reports_a_403_as_a_permission_problem():
    class Response:
        status_code = 403

    with patch("integrations.tasks.requests.get", return_value=Response()):
        assert validate_github_integration("tok") == (False, "Token lacks required permissions")
