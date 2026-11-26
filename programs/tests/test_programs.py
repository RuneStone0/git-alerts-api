"""Tests for the Program model, its FK links, and the ?program=<slug> list filters.

Two invariants matter more than the rest and are asserted directly:

* Deleting a Program must never delete or orphan-drop a Finding. Scan.program and
  Finding.program are SET_NULL, so the rows survive with the link cleared, exactly like
  Finding.scan already did when the scan factory throws a scan row away.
* The list endpoints keep their optional-pagination contract: a bare list without ?page= /
  ?page_size=, the {count,next,previous,results} envelope with them, and no raw secret in
  either shape unless ?include_value=1 is passed.
"""

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError, models, transaction
from rest_framework.test import APIClient

from findings.models import Finding
from programs.models import Program
from scans.models import Scan


def make_user():
    return User.objects.create_user("rune", "rune@local", "not-a-real-secret")


def make_program(slug, name=None):
    return Program.objects.create(slug=slug, name=name or slug.title(), domain=f"{slug}.test")


def make_scan(user, program, value="acme"):
    return Scan.objects.create(
        user=user, program=program, type=Scan.ScanTypes.ORG_REPOS, value=value,
        status=Scan.ScanStatus.COMPLETED,
    )


def make_finding(scan, program, n):
    """Synthetic placeholder values only; nothing here is a real credential."""
    return Finding.objects.create(
        scan=scan, program=program, repository=f"acme/repo{n}", type="PrivateKey",
        value=f"placeholder-{n}", file="key.pem", email="a@b.c", commit_hash=f"sha{n}",
    )


# --------------------------------------------------------------------------- model

@pytest.mark.django_db
def test_program_model_defaults_and_unique_slug():
    program = make_program("acme", "Acme Inc")

    assert program.source == Program.Source.MANUAL
    assert program.scope_read_on is None
    assert str(program) == "Acme Inc"
    assert Program._meta.get_field("slug").unique is True

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Program.objects.create(slug="acme", name="Acme duplicate")


def test_program_fks_are_nullable_and_set_null():
    for model in (Scan, Finding):
        field = model._meta.get_field("program")
        assert field.null is True and field.blank is True
        assert field.remote_field.on_delete is models.SET_NULL
        assert field.remote_field.model is Program

    # The pre-existing survival rule is untouched.
    assert Finding._meta.get_field("scan").remote_field.on_delete is models.SET_NULL


# --------------------------------------------------- migration / deletion safety

@pytest.mark.django_db
def test_deleting_a_program_keeps_its_scans_and_findings():
    user = make_user()
    program = make_program("acme")
    scan = make_scan(user, program)
    finding = make_finding(scan, program, 1)

    Program.objects.filter(pk=program.pk).delete()

    assert Program.objects.count() == 0
    finding.refresh_from_db()
    scan.refresh_from_db()
    assert Finding.objects.count() == 1
    assert finding.program_id is None
    assert scan.program_id is None
    assert finding.scan_id == scan.id  # the scan itself survived too


@pytest.mark.django_db
def test_deleting_a_scan_still_keeps_the_finding_and_its_program():
    user = make_user()
    program = make_program("acme")
    scan = make_scan(user, program)
    finding = make_finding(scan, program, 1)

    scan.delete()

    finding.refresh_from_db()
    assert finding.scan_id is None
    assert finding.program_id == program.id


# ------------------------------------------------------------------------ filters

@pytest.mark.django_db
def test_findings_filter_by_program_slug_keeps_the_pagination_contract():
    user = make_user()
    alpha = make_program("alpha")
    beta = make_program("beta")

    scan_alpha = make_scan(user, alpha, "acme")
    scan_beta = make_scan(user, beta, "globex")
    for n in range(3):
        make_finding(scan_alpha, alpha, n)
    make_finding(scan_beta, beta, 99)
    # A finding with no program at all: without ?program= it must still be listed.
    Finding.objects.create(
        scan=None, program=None, repository="loose/repo", type="PrivateKey",
        value="placeholder-loose", file="k.pem", email="a@b.c", commit_hash="sha-loose",
    )

    client = APIClient()
    client.force_authenticate(user=user)

    # Bare list, narrowed.
    rows = client.get("/findings/?program=alpha").data
    assert isinstance(rows, list)
    assert len(rows) == 3
    assert {row["program_slug"] for row in rows} == {"alpha"}
    assert all(row["program"] == alpha.id for row in rows)
    # Secret never rides in a list row, length does.
    assert all("value" not in row for row in rows)
    assert all(row["value_length"] == len("placeholder-0") for row in rows)

    # ?page= switches to the envelope, still narrowed.
    page = client.get("/findings/?program=alpha&page=1&page_size=2").data
    assert isinstance(page, dict)
    assert page["count"] == 3
    assert len(page["results"]) == 2
    assert page["next"] is not None
    assert {row["program_slug"] for row in page["results"]} == {"alpha"}

    # ?include_value=1 still opts the secret back in, filtered or not.
    opted_in = client.get("/findings/?program=alpha&include_value=1&page=1").data["results"]
    assert all(row["value"].startswith("placeholder-") for row in opted_in)

    # No filter means no narrowing: 3 + 1 + 1.
    assert len(client.get("/findings/").data) == 5

    # Unknown slug is an empty result, not an error.
    assert client.get("/findings/?program=nope").data == []


@pytest.mark.django_db
def test_scans_filter_by_program_slug_keeps_the_pagination_contract():
    user = make_user()
    alpha = make_program("alpha")
    beta = make_program("beta")
    scan_a1 = make_scan(user, alpha, "acme")
    scan_a2 = make_scan(user, alpha, "acme-labs")
    scan_b = make_scan(user, beta, "globex")
    make_scan(user, None, "unattached")

    client = APIClient()
    client.force_authenticate(user=user)

    rows = client.get("/scans/?program=alpha").data
    assert isinstance(rows, list)
    assert {row["id"] for row in rows} == {scan_a1.id, scan_a2.id}
    assert {row["program_slug"] for row in rows} == {"alpha"}

    page = client.get("/scans/?program=alpha&page=1&page_size=1").data
    assert page["count"] == 2
    assert len(page["results"]) == 1
    assert page["next"] is not None

    assert [row["id"] for row in client.get("/scans/?program=beta").data] == [scan_b.id]
    assert len(client.get("/scans/").data) == 4
