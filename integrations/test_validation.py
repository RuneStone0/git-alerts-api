"""Tests for GitHub token validation.

The host's DNS fails intermittently, so a network error says nothing about the token. These
tests pin the difference between "the network dropped" (retry, do not condemn the token) and
"GitHub rejected the token" (no retry, mark it failed).
"""
from unittest.mock import MagicMock, patch

import pytest
import requests

from integrations.tasks import (
    MAX_VALIDATION_ATTEMPTS,
    is_transient_error,
    validate_github_integration,
)


def response(status_code: int) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    return r


def dns_failure(*args, **kwargs):
    raise requests.ConnectionError(
        "HTTPSConnectionPool(host='api.github.com', port=443): Max retries exceeded "
        "(Caused by NameResolutionError(\"Failed to resolve 'api.github.com'\"))"
    )


def test_network_error_is_retried_and_reported_as_transient():
    get = MagicMock(side_effect=dns_failure)
    with patch("integrations.tasks.requests.get", get), patch("integrations.tasks.time.sleep"):
        is_valid, error_message = validate_github_integration("token")

    assert is_valid is False
    assert get.call_count == MAX_VALIDATION_ATTEMPTS
    assert is_transient_error(error_message)


def test_rejected_token_is_not_retried():
    get = MagicMock(return_value=response(401))
    with patch("integrations.tasks.requests.get", get), patch("integrations.tasks.time.sleep"):
        is_valid, error_message = validate_github_integration("token")

    assert is_valid is False
    assert get.call_count == 1
    assert error_message == "Token is invalid or expired"
    assert not is_transient_error(error_message)


def test_github_outage_is_treated_as_transient():
    get = MagicMock(return_value=response(503))
    with patch("integrations.tasks.requests.get", get), patch("integrations.tasks.time.sleep"):
        is_valid, error_message = validate_github_integration("token")

    assert is_valid is False
    assert get.call_count == MAX_VALIDATION_ATTEMPTS
    assert is_transient_error(error_message)


def test_recovers_when_a_later_attempt_succeeds():
    get = MagicMock(side_effect=[requests.ConnectionError("dns"), response(200)])
    with patch("integrations.tasks.requests.get", get), patch("integrations.tasks.time.sleep"):
        assert validate_github_integration("token") == (True, "")
    assert get.call_count == 2


def test_valid_token_answers_on_the_first_call():
    get = MagicMock(return_value=response(200))
    with patch("integrations.tasks.requests.get", get):
        assert validate_github_integration("token") == (True, "")
    assert get.call_count == 1


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Network error: Failed to resolve 'api.github.com'", True),
        ("Token is invalid or expired", False),
        ("GitHub API error: 404", False),
        ("", False),
        (None, False),
    ],
)
def test_is_transient_error(message, expected):
    assert is_transient_error(message) is expected
