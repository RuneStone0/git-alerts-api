import json

from django.contrib.auth.models import User
from django.test import TestCase

from findings.models import Finding, FindingOutbox
from findings.outbox import contract_payload, dedupe_key, emit, fingerprint, preview
from scans.models import Scan

SECRET = "AKIAIOSFODNN7EXAMPLE"


class OutboxTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("triage", password="x")
        self.scan = Scan.objects.create(
            user=self.user, type=Scan.ScanTypes.ORG_REPOS, value="acme"
        )
        self.finding = Finding.objects.create(
            scan=self.scan,
            repository="acme/api",
            type="AWS",
            value=SECRET,
            description="",
            file="config/prod.env",
            line=14,
            email="dev@acme.com",
            commit_hash="a1b2c3d",
        )

    def test_payload_never_contains_raw_secret(self):
        payload = contract_payload(self.finding)
        self.assertNotIn(SECRET, json.dumps(payload))
        self.assertEqual(payload["secret"]["fingerprint"], fingerprint(SECRET))
        self.assertIn("*", payload["secret"]["preview"])
        self.assertNotIn("IOSFODNN7", payload["secret"]["preview"])

    def test_payload_shape(self):
        p = contract_payload(self.finding)
        for key in ("contract_version", "id", "source", "kind", "title", "asset",
                    "scope", "severity", "confidence", "evidence", "dedupe_key",
                    "detected_at", "status"):
            self.assertIn(key, p)
        self.assertEqual(p["contract_version"], 1)
        self.assertEqual(p["id"], f"gitalerts:{self.finding.pk}")
        self.assertEqual(p["kind"], "secret")
        self.assertEqual(p["status"], "new")
        self.assertEqual(p["asset"]["type"], "repo_file")
        self.assertTrue(p["scope"]["authorized"])

    def test_emit_is_idempotent(self):
        row, created = emit(self.finding)
        self.assertTrue(created)
        again, created_again = emit(self.finding)
        self.assertFalse(created_again)
        self.assertEqual(row.seq, again.seq)
        self.assertEqual(FindingOutbox.objects.count(), 1)

    def test_cursor_view_requires_auth(self):
        emit(self.finding)
        resp = self.client.get("/outbox/findings/")
        self.assertIn(resp.status_code, (401, 403))

    def test_cursor_view_filters_by_seq(self):
        r1, _ = emit(self.finding)
        second = Finding.objects.create(
            scan=self.scan, repository="acme/web", type="Slack", value="xoxb-1234567890",
            description="", file=".env", line=2, email="dev@acme.com", commit_hash="d4e5f6",
        )
        r2, _ = emit(second)
        self.client.force_login(self.user)
        resp = self.client.get("/outbox/findings/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)
        resp = self.client.get(f"/outbox/findings/?since_seq={r1.seq}")
        body = resp.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["seq"], r2.seq)

    def test_bad_since_seq_returns_empty(self):
        emit(self.finding)
        self.client.force_login(self.user)
        resp = self.client.get("/outbox/findings/?since_seq=not-a-number")
        self.assertEqual(resp.json(), [])

    def test_dedupe_stable_for_same_secret(self):
        p1 = contract_payload(self.finding)
        p2 = contract_payload(self.finding)
        self.assertEqual(p1["dedupe_key"], p2["dedupe_key"])
        self.assertEqual(
            p1["dedupe_key"],
            dedupe_key("secret", "github.com", "acme/api/config/prod.env",
                       f"AWS:{fingerprint(SECRET)}"),
        )

    def test_backfill_command(self):
        from django.core.management import call_command
        from io import StringIO
        out = StringIO()
        call_command("backfill_outbox", stdout=out)
        self.assertEqual(FindingOutbox.objects.count(), 1)
        self.assertIn("emitted 1", out.getvalue())
