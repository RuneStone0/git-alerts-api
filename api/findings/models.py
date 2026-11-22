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




