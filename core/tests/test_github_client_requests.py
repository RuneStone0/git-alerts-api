"""GitHub client: rate limits, pagination and the per-endpoint helpers.

The retry tests next door cover the network blip and the rejected token. What is pinned here is the
rest of the request wrapper (both rate-limit families, the non-rate-limit 403), the two paginators,
the organisation test that decides whether a search hit is worth scanning, and every public helper,
so a renamed endpoint or a dropped pagination branch fails in pytest instead of silently returning a
short list of repositories.
"""

from unittest.mock import MagicMock, patch

import pytest
import requests

from core.clients.github_client import (
    GitHubAPIError,
    GitHubAuthError,
    GitHubClient,
    GitHubRateLimitError,
)


def _response(status=200, headers=None, payload=None, links=None):
    r = MagicMock()
    r.status_code = status
    r.ok = 200 <= status < 400
    r.headers = headers or {}
    r.json.return_value = payload if payload is not None else []
    r.links = links or {}
    r.args = None
    return r


def _rate_limited(resource: str, reset_in: int = 30):
    return _response(
        403,
        headers={
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Resource": resource,
            "X-RateLimit-Reset": "1000000000",
        },
    )


def test_headers_carry_the_token_and_the_api_version():
    headers = GitHubClient(token="tok")._headers()

    assert headers["Authorization"] == "Bearer tok"
    assert "github" in headers["Accept"]


def test_sleep_until_reset_waits_the_remaining_window():
    client = GitHubClient(token="t")
    response = _response(403, headers={"X-RateLimit-Reset": "1000060000"})

    with patch("core.clients.github_client.time.time", return_value=1000000000), \
         patch("core.clients.github_client.time.sleep") as sleep:
        client._sleep_until_reset(response)

    assert sleep.call_args.args[0] == 60000


def test_core_rate_limit_retries_then_gives_up():
    client = GitHubClient(token="t")

    with patch("core.clients.github_client.requests.request",
               return_value=_rate_limited("core")) as req, \
         patch("core.clients.github_client.time.sleep"):
        with pytest.raises(GitHubRateLimitError):
            client._request("GET", "https://api.github.com/orgs/x/repos")

    assert req.call_count == 4  # first try plus CORE_API_MAX_RETRIES


def test_core_rate_limit_waits_and_then_succeeds():
    client = GitHubClient(token="t")
    ok = _response(200, payload=[{"id": 1}])

    with patch("core.clients.github_client.requests.request",
               side_effect=[_rate_limited("core"), ok]) as req, \
         patch("core.clients.github_client.time.sleep") as sleep:
        response = client._request("GET", "https://api.github.com/orgs/x/repos")

    assert response is ok
    assert req.call_count == 2
    assert sleep.call_count == 1


def test_search_rate_limit_has_its_own_larger_budget():
    client = GitHubClient(token="t")
    ok = _response(200, payload={"items": []})

    with patch("core.clients.github_client.requests.request",
               side_effect=[_rate_limited("search"), ok]), \
         patch("core.clients.github_client.time.sleep"):
        assert client._request("GET", "https://api.github.com/search/code") is ok

    # The 21st attempt is refused rather than slept on again.
    with patch("core.clients.github_client.requests.request",
               return_value=_rate_limited("search")), \
         patch("core.clients.github_client.time.sleep"):
        with pytest.raises(GitHubRateLimitError):
            client._request("GET", "https://api.github.com/search/code", _retries=20)


def test_a_403_that_is_not_a_rate_limit_is_returned_to_the_caller():
    """A private repo answers 403 with no rate-limit headers: retrying would never help."""
    client = GitHubClient(token="t")
    forbidden = _response(403, headers={})

    with patch("core.clients.github_client.requests.request", return_value=forbidden):
        response = client._request("GET", "https://api.github.com/repos/x/y")

    assert response is forbidden


def test_a_bad_token_raises_the_specific_error():
    client = GitHubClient(token="t")

    with patch("core.clients.github_client.requests.request", return_value=_response(401)):
        with pytest.raises(GitHubAuthError):
            client._request("GET", "https://api.github.com/user")


def test_get_all_pages_follows_next_and_drops_params_on_later_pages():
    client = GitHubClient(token="t")
    first = _response(200, payload=[{"html_url": "a"}],
                      links={"next": {"url": "https://api.github.com/page/2"}})
    second = _response(200, payload=[{"html_url": "b"}], links={})

    with patch.object(client, "_request", side_effect=[first, second]) as req:
        rows = client._get_all_pages("https://api.github.com/page/1")

    assert [r["html_url"] for r in rows] == ["a", "b"]
    assert req.call_args_list[1].kwargs["url"] == "https://api.github.com/page/2"
    assert req.call_args_list[1].kwargs["params"] is None


def test_get_all_pages_raises_instead_of_returning_a_partial_list():
    client = GitHubClient(token="t")

    with patch.object(client, "_request", return_value=_response(500)):
        with pytest.raises(GitHubAPIError):
            client._get_all_pages("https://api.github.com/page/1")


def test_search_pages_follow_next_and_sleep_between_pages():
    client = GitHubClient(token="t")
    first = _response(200, payload={"items": [{"id": 1}]},
                      links={"next": {"url": "https://api.github.com/search/code?page=2"}})
    second = _response(200, payload={"items": [{"id": 2}]}, links={})

    with patch.object(client, "_request", side_effect=[first, second]), \
         patch("core.clients.github_client.time.sleep") as sleep:
        rows = client._search_all_pages(
            "https://api.github.com/search/code", delay_seconds=7, params={"q": "x"}
        )

    assert [r["id"] for r in rows] == [1, 2]
    assert sleep.call_args.args[0] == 7


def test_search_pages_raise_on_an_error_status():
    client = GitHubClient(token="t")

    with patch.object(client, "_request", return_value=_response(422)):
        with pytest.raises(GitHubAPIError):
            client._search_all_pages("https://api.github.com/search/code")


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"owner": {"type": "Organization"}}, True),
        ({"repository": {"owner": {"type": "Organization"}}}, True),
        ({"owner": {"type": "User"}}, False),
        ({"repository": {"owner": {"type": "User"}}}, False),
        ({}, False),
        ({"owner": None}, False),
    ],
)
def test_is_organization_repo(payload, expected):
    assert GitHubClient.is_organization_repo(payload) is expected


def test_org_repo_and_member_helpers_call_the_right_endpoints():
    client = GitHubClient(token="t")
    repos = [{"html_url": "https://github.com/acme/a"}]

    with patch.object(client, "_get_all_pages", return_value=repos) as pages:
        assert client.get_org_repos("acme") == repos
        assert pages.call_args.kwargs["url"].endswith("/orgs/acme/repos")

        assert client.get_user_repos("rune") == repos
        assert pages.call_args.kwargs["url"].endswith("/users/rune/repos")

    with patch.object(client, "_get_all_pages", return_value=[{"login": "rune"}]):
        assert client.get_org_members("acme") == ["rune"]


def test_org_members_repos_collects_every_member():
    client = GitHubClient(token="t")

    with patch.object(client, "get_org_members", return_value=["rune", "ada"]), \
         patch.object(client, "get_user_repos",
                      side_effect=[[{"html_url": "r1"}], [{"html_url": "r2"}]]) as user_repos:
        rows = client.get_org_members_repos("acme")

    assert [r["html_url"] for r in rows] == ["r1", "r2"]
    assert user_repos.call_count == 2


@pytest.mark.parametrize(
    "method,endpoint",
    [
        ("search_code", "/search/code"),
        ("search_commits", "/search/commits"),
        ("search_issues", "/search/issues"),
        ("search_repositories", "/search/repositories"),
    ],
)
def test_search_helpers_hit_their_endpoint_with_the_query(method, endpoint):
    client = GitHubClient(token="t")

    with patch.object(client, "_search_all_pages", return_value=[{"id": 1}]) as pages:
        rows = getattr(client, method)("acme")

    assert rows == [{"id": 1}]
    assert pages.call_args.kwargs["url"].endswith(endpoint)
    assert pages.call_args.kwargs["params"]["q"] == "acme"


def test_search_users_expands_each_user_into_repos():
    client = GitHubClient(token="t")

    with patch.object(client, "_search_all_pages", return_value=[{"login": "rune"}]), \
         patch.object(client, "get_user_repos", return_value=[{"html_url": "r1"}]) as user_repos:
        rows = client.search_users("acme")

    assert rows == [{"html_url": "r1"}]
    user_repos.assert_called_once_with(username="rune")
