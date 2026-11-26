"""Emit findings as contract v1 records into the outbox.

The outbox is append-only and is read by the triage service with a seq cursor. The raw secret never
enters a payload: only a salted fingerprint and a masked preview. Scanners stay scanners.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re

from django.conf import settings

logger = logging.getLogger(__name__)

CONTRACT_VERSION = 1
PROGRAMME_RE = re.compile(r"^[a-z0-9.-]+$")

HIGH_SIGNAL = ("aws", "private key", "rsa", "slack", "github token", "stripe", "twilio",
               "sendgrid", "google api", "azure", "npm token", "shopify")


def _salt() -> str:
    salt = getattr(settings, "GITALERTS_FINDING_SALT", "") or ""
    if not salt:
        logger.warning(
            "event=outbox_salt_missing detail=falling_back_to_SECRET_KEY "
            "action=set GITALERTS_FINDING_SALT so fingerprints survive a key rotation"
        )
        return settings.SECRET_KEY
    return salt


def fingerprint(value: str, salt: str | None = None) -> str:
    return "sha256:" + hashlib.sha256(((salt if salt is not None else _salt()) + value).encode()).hexdigest()


def preview(value: str) -> str:
    if len(value) <= 6:
        return "****"
    return value[:4] + "*" * min(16, len(value) - 4)


def dedupe_key(kind: str, host: str, path: str = "", cls: str = "") -> str:
    material = "|".join([
        (kind or "").lower().strip(),
        (host or "").lower().strip().rstrip("."),
        (path or "/").split("?")[0].rstrip("/") or "/",
        (cls or "").lower().strip(),
    ])
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def severity_for(finding_type: str) -> str:
    t = (finding_type or "").lower()
    return "high" if any(k in t for k in HIGH_SIGNAL) else "medium"


def programme_for(scan_value: str) -> str:
    candidate = (scan_value or "").lower().strip().rstrip("/")
    candidate = re.sub(r"^https?://", "", candidate)
    candidate = candidate.split("/")[0]
    if PROGRAMME_RE.match(candidate):
        return candidate
    return "unknown.github"


def contract_payload(finding, programme: str | None = None) -> dict:
    """Build a contract v1 record from a Finding row. Never includes `finding.value`."""
    repo = finding.repository or ""
    path = finding.file or ""
    detector = finding.type or "unknown"
    fp = fingerprint(str(finding.value or ""))
    prog = programme or programme_for(getattr(finding.scan, "value", "") or "")
    payload = {
        "contract_version": CONTRACT_VERSION,
        "id": f"gitalerts:{finding.pk}",
        "source": "gitalerts",
        "producer_version": "1.0.0",
        "kind": "secret",
        "title": f"{detector} in {repo}"[:200],
        "summary": (finding.description or f"{detector} detected in {repo} at {path}")[:1000],
        "asset": {
            "type": "repo_file",
            "value": f"{repo}/{path}",
            "host": "github.com",
        },
        "scope": {
            "programme": prog,
            "rule": f"org in programme scope: {getattr(finding.scan, 'value', '')}",
            "authorized": True,
            "checked_at": finding.created_at.isoformat() if finding.created_at else None,
        },
        "severity": severity_for(detector),
        "confidence": "medium",
        "evidence": {
            "kind": "file_snippet",
            "pointer": f"gitalerts:findings:{finding.pk}",
            "captured_at": finding.created_at.isoformat() if finding.created_at else None,
        },
        "secret": {
            "fingerprint": fp,
            "preview": preview(str(finding.value or "")),
            "detector": detector,
            "location": {
                "repo": repo,
                "path": path,
                "line": finding.line or 1,
                "commit": finding.commit_hash or "",
            },
        },
        "dedupe_key": dedupe_key("secret", "github.com", f"{repo}/{path}", f"{detector}:{fp}"),
        "detected_at": finding.created_at.isoformat() if finding.created_at else None,
        "status": "new",
    }
    # A leak of the raw value here would defeat the whole design. Fail loudly instead.
    if finding.value and str(finding.value) in json.dumps(payload):
        raise ValueError(f"raw secret leaked into contract payload for finding {finding.pk}")
    return payload


def emit(finding, programme: str | None = None):
    """Write one outbox row for a finding. Idempotent on (finding_id, contract_version)."""
    from findings.models import FindingOutbox

    payload = contract_payload(finding, programme=programme)
    row, created = FindingOutbox.objects.get_or_create(
        finding_id=str(finding.pk),
        contract_version=CONTRACT_VERSION,
        defaults={"payload": payload},
    )
    if created:
        logger.info(
            f"event=outbox_emitted finding={finding.pk} seq={row.seq} programme={payload['scope']['programme']}"
        )
    return row, created
