"""The scan orchestrator: what a scan actually does.

`save_findings`' verification rules live next door. This file covers the flow around them: which
GitHub helper each scan type calls, the ownership filter, the recently-scanned skip, the per-repo
history rows, and the counters the UI reports. These are the paths that decide whether a scan
scanned anything at all, and they were previously exercised only by running a real scan.
"""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import RepoScanHistory, SystemSettings
from core.services.scan_orchestrator import ScanOrchestrator
from findings.models import Finding, IgnoreFindingDomain, IgnoreFindingType
from scans.models import Scan


class FakeGitHub:
    """Only the surface the orchestrator uses: list calls, the org test, and one raw request."""

    base_url = "https://api.github.com"

    def __init__(self, repos, org_payload=None, fail_with=None, fail_request=None):
        self.repos = repos
        self.org_payload = org_payload if org_payload is not None else {"org": True}
        self.fail_with = fail_with
        self.fail_request = fail_request
        self.calls: list[tuple[str, str]] = []

    def _list(self, name, value):
        self.calls.append((name, value))
        if self.fail_with:
            raise self.fail_with
        return self.repos

    def get_org_repos(self, value):
        return self._list("get_org_repos", value)

    def get_org_members_repos(self, value):
        return self._list("get_org_members_repos", value)

    def search_code(self, value):
        return self._list("search_code", value)

    def search_commits(self, value):
        return self._list("search_commits", value)

    def search_issues(self, value):
        return self._list("search_issues", value)

    def search_repositories(self, value):
        return self._list("search_repositories", value)

    def search_users(self, value):
        return self._list("search_users", value)

    @staticmethod
    def is_organization_repo(payload):
        return bool(payload.get("org"))

    def _request(self, method, url):
        if self.fail_request:
            raise self.fail_request
        payload = self.org_payload

        class Response:
            @staticmethod
            def json():
                return payload

        return Response()


class FakeTruffleHog:
    def __init__(self, findings=None, error_for=()):
        self.findings = findings or {}
        self.error_for = set(error_for)
        self.scanned: list[str] = []

    def scan_repository(self, repository_url, only_verified):
        self.scanned.append(repository_url)
        if repository_url in self.error_for:
            raise RuntimeError("scanner blew up")
        return self.findings.get(repository_url, [])


def make_scan(**kwargs) -> Scan:
    user = kwargs.pop("user", None) or get_user_model().objects.create_user(
        username=f"u{get_user_model().objects.count()}", password="not-a-real-secret"
    )
    defaults = dict(type=Scan.ScanTypes.ORG_REPOS, value="acme", status=Scan.ScanStatus.INPROGRESS)
    defaults.update(kwargs)
    return Scan.objects.create(user=user, **defaults)


def make_finding(**overrides):
    finding = {
        "repository": "https://github.com/acme/app",
        "commit": "abc123",
        "file": "config.txt",
        "line": 3,
        "author": "dev <dev@acme.test>",
        "type": "Stripe",
        "description": "Stripe key",
        "value": "sk_live_x",
        "verified": True,
    }
    finding.update(overrides)
    return finding


def orchestrator(scan, github, trufflehog):
    return ScanOrchestrator(scan=scan, github_client=github, trufflehog_client=trufflehog)


@pytest.mark.django_db
def test_a_scan_counts_repos_and_saves_what_the_scanner_returns():
    repos = [{"html_url": "https://github.com/acme/app"},
             {"html_url": "https://github.com/acme/lib"}]
    github = FakeGitHub(repos)
    trufflehog = FakeTruffleHog({repos[0]["html_url"]: [make_finding()]})
    scan = make_scan()

    orchestrator(scan, github, trufflehog).run()

    scan.refresh_from_db()
    assert scan.total_repositories == 2
    assert scan.scanned_repositories == 2
    assert scan.ignored_repositories == 0
    assert scan.total_findings == 1
    assert Finding.objects.count() == 1
    assert RepoScanHistory.objects.filter(
        status=RepoScanHistory.ScanStatus.COMPLETED
    ).count() == 2


@pytest.mark.django_db
def test_one_failing_repository_does_not_abort_the_scan():
    repos = [{"html_url": "https://github.com/acme/bad"},
             {"html_url": "https://github.com/acme/good"}]
    trufflehog = FakeTruffleHog(error_for={repos[0]["html_url"]})
    scan = make_scan()

    orchestrator(scan, FakeGitHub(repos), trufflehog).run()

    scan.refresh_from_db()
    assert scan.scanned_repositories == 2
    assert RepoScanHistory.objects.get(
        repository=repos[0]["html_url"]
    ).status == RepoScanHistory.ScanStatus.FAILED
    assert RepoScanHistory.objects.get(
        repository=repos[1]["html_url"]
    ).status == RepoScanHistory.ScanStatus.COMPLETED


@pytest.mark.django_db
def test_a_github_failure_propagates_so_the_task_can_mark_the_scan_failed():
    scan = make_scan()

    with pytest.raises(RuntimeError):
        orchestrator(scan, FakeGitHub([], fail_with=RuntimeError("api down")),
                     FakeTruffleHog()).run()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "scan_type,repo,called",
    [
        (Scan.ScanTypes.ORG_REPOS, {"html_url": "https://github.com/acme/a"}, "get_org_repos"),
        (Scan.ScanTypes.ORG_USERS, {"html_url": "https://github.com/acme/a"},
         "get_org_members_repos"),
        (Scan.ScanTypes.SEARCH_CODE,
         {"repository": {"html_url": "https://github.com/acme/a"}}, "search_code"),
        (Scan.ScanTypes.SEARCH_COMMITS,
         {"repository": {"html_url": "https://github.com/acme/a"}}, "search_commits"),
        (Scan.ScanTypes.SEARCH_ISSUES,
         {"html_url": "https://github.com/acme/a/issues/7"}, "search_issues"),
        (Scan.ScanTypes.SEARCH_REPOS, {"html_url": "https://github.com/acme/a"},
         "search_repositories"),
        (Scan.ScanTypes.SEARCH_USERS, {"html_url": "https://github.com/acme/a"}, "search_users"),
    ],
)
def test_each_scan_type_asks_github_for_the_right_shape(scan_type, repo, called):
    github = FakeGitHub([repo])
    scan = make_scan(type=scan_type)

    orchestrator(scan, github, FakeTruffleHog()).run()

    assert github.calls and github.calls[0][0] == called
    assert scan.scanned_repositories == 1


@pytest.mark.django_db
def test_org_repos_only_drops_search_hits_that_belong_to_a_person():
    settings = SystemSettings.get_settings()
    settings.org_repos_only = True
    settings.save()
    repos = [
        {"html_url": "https://github.com/acme/org", "org": True},
        {"html_url": "https://github.com/someone/personal", "org": False},
    ]
    scan = make_scan(type=Scan.ScanTypes.SEARCH_REPOS)

    orchestrator(scan, FakeGitHub(repos), FakeTruffleHog()).run()

    assert scan.total_repositories == 1


@pytest.mark.django_db
def test_the_issues_filter_resolves_the_repo_behind_each_hit():
    settings = SystemSettings.get_settings()
    settings.org_repos_only = True
    settings.save()
    hits = [
        {"html_url": "https://github.com/acme/a/issues/1",
         "repository_url": "https://api.github.com/repos/acme/a"},
    ]
    scan = make_scan(type=Scan.ScanTypes.SEARCH_ISSUES)

    orchestrator(scan, FakeGitHub(hits), FakeTruffleHog()).run()

    assert scan.total_repositories == 1


@pytest.mark.django_db
def test_an_issue_hit_whose_repo_url_cannot_be_parsed_is_dropped():
    """The filter only ever narrows: an unparseable url is logged and skipped, never kept."""
    settings = SystemSettings.get_settings()
    settings.org_repos_only = True
    settings.save()
    hits = [{"html_url": "https://github.com/acme/b/issues/2", "repository_url": ""}]
    scan = make_scan(type=Scan.ScanTypes.SEARCH_ISSUES)

    orchestrator(scan, FakeGitHub(hits), FakeTruffleHog()).run()

    assert scan.total_repositories == 0


@pytest.mark.django_db
def test_a_failed_repo_lookup_drops_that_hit_instead_of_the_scan():
    settings = SystemSettings.get_settings()
    settings.org_repos_only = True
    settings.save()
    hits = [{"html_url": "https://github.com/acme/a/issues/1",
             "repository_url": "https://api.github.com/repos/acme/a"}]
    scan = make_scan(type=Scan.ScanTypes.SEARCH_ISSUES)

    orchestrator(scan, FakeGitHub(hits, fail_request=RuntimeError("api down")),
                 FakeTruffleHog()).run()

    assert scan.total_repositories == 0


@pytest.mark.django_db
def test_a_recently_scanned_repo_is_skipped_and_recorded():
    repo = "https://github.com/acme/app"
    RepoScanHistory.objects.create(
        repository=repo, status=RepoScanHistory.ScanStatus.COMPLETED, completed_at=timezone.now()
    )
    trufflehog = FakeTruffleHog()
    scan = make_scan()

    orchestrator(scan, FakeGitHub([{"html_url": repo}]), trufflehog).run()

    scan.refresh_from_db()
    assert scan.scanned_repositories == 0
    assert scan.ignored_repositories == 1
    assert trufflehog.scanned == []
    assert RepoScanHistory.objects.filter(
        repository=repo, status=RepoScanHistory.ScanStatus.SKIPPED
    ).exists()


@pytest.mark.django_db
def test_a_scan_older_than_the_skip_window_is_retaken():
    repo = "https://github.com/acme/app"
    RepoScanHistory.objects.create(
        repository=repo,
        status=RepoScanHistory.ScanStatus.COMPLETED,
        completed_at=timezone.now() - timedelta(days=90),
    )
    orch = orchestrator(make_scan(), FakeGitHub([]), FakeTruffleHog())

    assert orch.is_recently_scanned(repo) is False
    assert orch.is_recently_scanned("https://github.com/acme/never-seen") is False


@pytest.mark.django_db
def test_ignored_types_and_domains_are_not_saved():
    IgnoreFindingType.objects.create(type="Stripe")
    IgnoreFindingDomain.objects.create(domain="acme.test")
    scan = make_scan()
    orch = orchestrator(scan, FakeGitHub([]), FakeTruffleHog())

    assert orch.should_ignore_finding(make_finding()) is True
    assert orch.should_ignore_finding(make_finding(type="AWS")) is True
    assert orch.should_ignore_finding(make_finding(type="AWS", author="dev <ok.test>")) is False

    orch.save_findings("https://github.com/acme/app", [make_finding()])
    scan.refresh_from_db()
    assert scan.ignored_findings == 1
    assert Finding.objects.count() == 0


@pytest.mark.django_db
def test_the_same_secret_twice_updates_one_row():
    scan = make_scan()
    orch = orchestrator(scan, FakeGitHub([]), FakeTruffleHog())

    orch.save_findings("https://github.com/acme/app", [make_finding()])
    orch.save_findings("https://github.com/acme/app", [make_finding()])

    scan.refresh_from_db()
    assert Finding.objects.count() == 1
    assert scan.total_findings == 2


@pytest.mark.parametrize(
    "scan_type,response,expected",
    [
        (Scan.ScanTypes.ORG_REPOS, {"html_url": "https://github.com/a/b"},
         "https://github.com/a/b"),
        (Scan.ScanTypes.SEARCH_CODE,
         {"repository": {"html_url": "https://github.com/a/b"}}, "https://github.com/a/b"),
        (Scan.ScanTypes.SEARCH_ISSUES, {"html_url": "https://github.com/a/b/issues/9"},
         "https://github.com/a/b"),
        (Scan.ScanTypes.SEARCH_ISSUES, {"html_url": "https://github.com/a/b/pull/9"},
         "https://github.com/a/b"),
        (Scan.ScanTypes.SEARCH_ISSUES, {"html_url": "https://github.com/a/b"},
         "https://github.com/a"),
    ],
)
def test_repo_url_extraction_per_response_shape(scan_type, response, expected):
    assert ScanOrchestrator.extract_repo_url_from_response(scan_type, response) == expected


@pytest.mark.parametrize(
    "email,expected",
    [("dev <Dev@Acme.TEST>", "acme.test"), ("plain@acme.test", ""), ("", "")],
)
def test_domain_extraction(email, expected):
    assert ScanOrchestrator.extract_domain(email) == expected
