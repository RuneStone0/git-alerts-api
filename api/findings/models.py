from django.db import models
from scans.models import Scan

class Finding(models.Model):
    """Finding model for showing scan results"""
    scan = models.ForeignKey(Scan, on_delete=models.CASCADE, related_name="findings")
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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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






class FindingOutbox(models.Model):
    """Append-only contract records for the triage service to pull.

    One row per (finding, contract_version). Rows are never edited or deleted: a corrected finding is a
    new row with `supersedes` inside the payload. Consumers advance a cursor over `seq`.
    """

    seq = models.BigAutoField(primary_key=True)
    finding_id = models.CharField(max_length=64)
    contract_version = models.IntegerField(default=1)
    payload = models.JSONField()
    emitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = (("finding_id", "contract_version"),)
        ordering = ["seq"]

    def __str__(self):
        return f"outbox {self.seq} finding={self.finding_id} v{self.contract_version}"
