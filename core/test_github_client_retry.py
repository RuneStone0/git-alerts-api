"""Tests for the GitHub client's network retry.

Regression: this host's DNS returns "Temporary failure in name resolution" now and then, and a
single blip used to abort an entire organisation scan.
"""
from unittest.mock import MagicMock, patch

import pytest
import requests

from core.clients.github_client import GitHubAPIError, GitHubClient


def _response(status=200, headers=None, payload=None):
    r = MagicMock()
    r.status_code = status
    r.ok = 200 <= status < 400
    r.headers = headers or {}
    r.json.return_value = payload if payload is not None else []
    r.links = {}
    return r


def test_network_error_is_retried_then_succeeds():
    client = GitHubClient(token="t")
    ok = _response()
    with patch("core.clients.github_client.requests.request",
               side_effect=[requests.ConnectionError("name resolution"), ok]) as req, \
         patch("core.clients.github_client.time.sleep"):
        response = client._request("GET", "https://api.github.com/orgs/x/repos")
    assert response is ok
    assert req.call_count == 2


def test_network_error_gives_up_with_a_github_api_error():
    client = GitHubClient(token="t")
    with patch("core.clients.github_client.requests.request",
               side_effect=requests.ConnectionError("name resolution")) as req, \
         patch("core.clients.github_client.time.sleep"):
        with pytest.raises(GitHubAPIError):
            client._request("GET", "https://api.github.com/orgs/x/repos")
    assert req.call_count == 5  # first try plus four retries


def test_a_rejected_token_is_not_retried():
    client = GitHubClient(token="t")
    with patch("core.clients.github_client.requests.request",
               return_value=_response(401)) as req, \
         patch("core.clients.github_client.time.sleep"):
        with pytest.raises(Exception):
            client._request("GET", "https://api.github.com/user")
    assert req.call_count == 1
