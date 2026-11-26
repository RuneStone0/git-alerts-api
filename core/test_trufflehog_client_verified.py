"""Tests that the TruffleHog client carries the scanner's verified verdict through.

`--only-verified` filters on TruffleHog's `Verified` field. Dropping the field while parsing
made the setting unauditable, so it is parsed and kept on every finding now.
"""
import json
from unittest.mock import patch

from core.clients.trufflehog_client import TruffleHogClient


def _line(detector, raw, verified):
    return json.dumps({
        "DetectorName": detector,
        "DetectorDescription": f"{detector} key",
        "Raw": raw,
        "Verified": verified,
        "SourceMetadata": {"Data": {"Git": {
            "repository": "https://github.com/acme/app",
            "commit": "abc123",
            "file": "config.txt",
            "line": 3,
            "email": "dev@acme.test",
        }}},
    })


class _Run:
    def __init__(self, stdout):
        self.stdout = stdout
        self.returncode = 0


def test_verified_flag_is_preserved_per_finding():
    output = "\n".join([
        _line("Stripe", "sk_live_x", True),
        _line("BscScan", "81Y3M1IIMMBTT1ND7TY1MHD5EGP4T59WP7", True),
        _line("Stripe", "sk_live_dead", False),
    ])
    with patch("core.clients.trufflehog_client.subprocess.run", return_value=_Run(output)):
        findings = TruffleHogClient().scan_repository("https://github.com/acme/app")
    assert [f["verified"] for f in findings] == [True, True, False]
    assert [f["type"] for f in findings] == ["Stripe", "BscScan", "Stripe"]


def test_only_verified_flag_is_passed_to_the_cli():
    with patch("core.clients.trufflehog_client.subprocess.run", return_value=_Run("")) as run:
        TruffleHogClient().scan_repository("https://github.com/acme/app", only_verified=True)
    assert "--only-verified" in run.call_args[0][0]

    with patch("core.clients.trufflehog_client.subprocess.run", return_value=_Run("")) as run:
        TruffleHogClient().scan_repository("https://github.com/acme/app", only_verified=False)
    assert "--only-verified" not in run.call_args[0][0]


def test_a_missing_verified_field_is_false():
    payload = json.loads(_line("Stripe", "sk_live_x", True))
    payload.pop("Verified")
    with patch("core.clients.trufflehog_client.subprocess.run",
               return_value=_Run(json.dumps(payload))):
        findings = TruffleHogClient().scan_repository("https://github.com/acme/app")
    assert findings[0]["verified"] is False


def test_a_timed_out_repository_returns_no_findings_instead_of_raising():
    """A 600s timeout is recorded as zero findings and logged; it must not fail the whole scan."""
    import subprocess

    with patch("core.clients.trufflehog_client.subprocess.run",
               side_effect=subprocess.TimeoutExpired(cmd="trufflehog", timeout=600)):
        assert TruffleHogClient().scan_repository("https://github.com/acme/app") == []
