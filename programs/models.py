from django.db import models


class Program(models.Model):
    """A bug bounty / VDP program that scans and findings belong to.

    Before this model the API had no way to say which program a scan was run for, so the scan
    factory had to keep that mapping in its own SQLite database. A program is deliberately
    descriptive only: it records the policy and channel a finding would be reported through, and
    the scope line as it was read on a given date, so a report can quote its authorisation.
    """

    class Source(models.TextChoices):
        CRAWLER = "crawler", "Crawler"
        MANUAL = "manual", "Manual"

    # Stable, URL-safe identity used by ?program=<slug> filters and by the factory's registry.
    slug = models.SlugField(max_length=255, unique=True)
    name = models.CharField(max_length=512)
    domain = models.CharField(max_length=255, blank=True, default="")

    policy_url = models.URLField(max_length=2048, blank=True, default="")
    channel_contact = models.CharField(max_length=512, blank=True, default="")
    channel_url = models.URLField(max_length=2048, blank=True, default="")

    # The program's own words about what is in scope, plus the date that was read. Keeping the
    # read date next to the quote is what makes a scope claim checkable later.
    scope_note = models.TextField(blank=True, default="")
    scope_read_on = models.DateField(null=True, blank=True)

    payout_note = models.TextField(blank=True, default="")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name or self.slug

    class Meta:
        verbose_name = "Program"
        verbose_name_plural = "Programs"
        ordering = ["name", "slug"]
