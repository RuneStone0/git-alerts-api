"""Whether a scanner's "verified" verdict is worth repeating to a human.

TruffleHog verifies a secret by calling the provider with it, and GitAlerts passes
`--only-verified`, so a stored finding is meant to mean "this credential worked".

The block-explorer family breaks that promise. Their APIs answer HTTP 200 with an error
payload for any well-formed string, so the verifier reports `Verified: true` for values that
cannot be credentials. Reproduced 2026-11-22 with the binaries GitAlerts pins (3.83.7) and CI
installs (3.100.0): a GitHub workflow line reading

    BSCSCAN_API_KEY: ${{ secrets.81Y3M1IIMMBTT1ND7TY1MHD5EGP4T59WP7 }}

came back as `DetectorName=BscScan, Verified=true, Raw=81Y3M1IIMMBTT1ND7TY1MHD5EGP4T59WP7`.
A secret's *name* cannot authenticate anywhere. Those APIs also answer anonymous calls, so no
independent probe can rescue the verdict either: the family is unverifiable in both directions.

Every other detector is taken at face value. Stripe, AWS and friends correctly drop values
that do not authenticate, which the same experiment confirmed.
"""
from __future__ import annotations

# Lowercase detector names whose "verified" claim is never trusted. TruffleHog names the
# detector after the product, and Etherscan's family has one API shape and one defect.
UNTRUSTED_VERIFIERS = frozenset({
    "bscscan",
    "etherscan",
    "polygonscan",
    "snowtrace",
    "ftmscan",
    "arbiscan",
    "optimisticetherscan",
    "blockscout",
    "explorer",
})


def is_trusted_verification(detector: str | None, verified: bool | None) -> bool:
    """True only when the scanner verified the value and its verifier is trustworthy."""
    if not verified:
        return False
    name = (detector or "").strip().lower()
    return name not in UNTRUSTED_VERIFIERS
