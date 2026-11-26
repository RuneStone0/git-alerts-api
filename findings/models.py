import hashlib

from django.db import models
from scans.models import Scan

class Finding(models.Model):
    """Finding model for showing scan results"""

    # SET_NULL, not CASCADE: finding extraction must survive the scan row being deleted, so a
    # high-volume pipeline can throw the scan scaffolding away and keep the findings.
    scan = models.ForeignKey(
        Scan, on_delete=models.SET_NULL, related_name="findings", null=True, blank=True
    )
    # SET_NULL for the same reason: a finding outlives the program row it was discovered under.
    # Deleting a Program clears this link and touches nothing else.
    program = models.ForeignKey(
        "programs.Program", on_delete=models.SET_NULL, related_name="findings", null=True, blank=True
    )
    repository = models.CharField(max_length=512)
    type = models.CharField(max_length=512)
    value = models.TextField()
    description = models.CharField(max_length=512, blank=True)
    file = models.CharField(max_length=512)
    line = models.IntegerField(null=True, blank=True)

    email = models.CharField(max_length=255)
    commit_hash = models.CharField(max_length=255)
    commit_url = models.CharField(max_length=2048, null=True, blank=True)
    validated = models.BooleanField(default=False)

    # GitAlerts' own record of what a human did with this row, kept apart from `validated` (the
    # scanner's opinion of the credential) and from the factory's verdict (the pipeline's opinion of
    # the report). Nothing writes back into the review snapshot from here.
    REPORT_STATUS = [
        ("", "Not reported"),
        ("reported", "Reported"),
    ]
    report_status = models.CharField(max_length=16, choices=REPORT_STATUS, blank=True, default="")
    reported_at = models.DateTimeField(null=True, blank=True)

    # A human's disagreement with a verdict, recorded as a claim the reviewer settles rather than
    # as a toggle. The three values are deliberately separate: a detector error, someone else's
    # credential, and a real finding this programme cannot receive are three different
    # corrections, and only the first should ever feed a precision number.
    #
    # A claim never writes `validated`, `report_status` or the review snapshot. The factory owns
    # the verdict; this is the input to the reviewer that challenges it.
    HUMAN_VERDICT = [
        ("", "No claim"),
        ("detector_wrong", "Detector was wrong"),
        ("not_ours", "Not this org's credential"),
        ("not_reportable", "Real, not reportable here"),
    ]
    # The reason must belong to the claim, so one click cannot mean two things. Codes match
    # `validation.context` on the pipeline side.
    HUMAN_REASONS = {
        "detector_wrong": ("scanner_fixture", "fixture_in_detector_source"),
        "not_ours": ("upstream_inherited", "vendored_path", "documented_public", "same_value_as_earlier"),
        "not_reportable": (
            "live_not_eligible", "courtesy_out_of_scope", "scope_unlisted_repo", "scope_mismatch",
            "scope_unknown", "no_program", "no_impact_by_design", "removed_from_tree", "revoked",
            "test_path_excluded",
        ),
    }
    human_verdict = models.CharField(max_length=20, choices=HUMAN_VERDICT, blank=True, default="")
    human_reason = models.CharField(max_length=64, blank=True, default="")
    human_note = models.CharField(max_length=512, blank=True, default="")
    human_at = models.DateTimeField(null=True, blank=True)

    # Identity of the finding itself, independent of which scan saw it last, so re-scanning a
    # repository updates instead of duplicating.
    fingerprint = models.CharField(max_length=64, unique=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @staticmethod
    def make_fingerprint(repository: str, commit_hash: str, file: str, type: str, value: str) -> str:
        """Stable identity for a secret in a repository."""
        raw = "\x1f".join(str(part or "") for part in (repository, commit_hash, file, type, value))
        return hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()

    def save(self, *args, **kwargs):
        if not self.fingerprint:
            self.fingerprint = self.make_fingerprint(
                self.repository, self.commit_hash, self.file, self.type, self.value
            )
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.type} - {self.value} - {self.email}"
    
    class Meta:
        verbose_name = "Finding"
        verbose_name_plural = "Findings"
        ordering = ["-created_at"]

class IgnoreFindingType(models.Model):
    """Model for managing ignored findings"""
    type = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.type}"
    
    class Meta:
        verbose_name = "Ignored Finding Type"
        verbose_name_plural = "Ignored Finding Types"
        ordering = ["type"]

class IgnoreFindingDomain(models.Model):
    """Model for managing ignored domains"""
    domain = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.domain}"
    
    class Meta:
        verbose_name = "Ignored Email Domain"
        verbose_name_plural = "Ignored Email Domains"
        ordering = ["domain"]




