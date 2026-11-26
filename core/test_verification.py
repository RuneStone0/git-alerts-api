"""Tests for the per-detector trust decision on TruffleHog's verified flag.

Regression: GitAlerts stored every finding with `validated=False`, so the `--only-verified`
setting was invisible after the fact. Recording it exposed a second problem: the block-explorer
verifier reports `Verified: true` for any 34-character string, including a GitHub workflow
secret's *name*.
"""
from core.verification import is_trusted_verification


def test_a_verified_non_explorer_detector_is_trusted():
    assert is_trusted_verification("Stripe", True) is True
    assert is_trusted_verification("AWS", True) is True
    assert is_trusted_verification("Infura", True) is True


def test_an_unverified_value_is_never_trusted():
    assert is_trusted_verification("Stripe", False) is False
    assert is_trusted_verification("BscScan", False) is False
    assert is_trusted_verification("Stripe", None) is False


def test_the_explorer_family_is_never_trusted_even_when_verified():
    # Reproduced against 3.83.7 and 3.100.0: `${{ secrets.81Y3M1IIMBTT1ND7TY1MHD5EGP4T59WP7 }}`
    # comes back as DetectorName=BscScan, Verified=true.
    for detector in ("BscScan", "bscscan", "Etherscan", "PolygonScan", "Snowtrace", "Arbiscan"):
        assert is_trusted_verification(detector, True) is False


def test_detector_matching_is_case_and_whitespace_insensitive():
    assert is_trusted_verification("  bscScan ", True) is False
    assert is_trusted_verification("", True) is True
    assert is_trusted_verification(None, True) is True
