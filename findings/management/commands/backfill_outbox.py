"""Backfill contract records for findings that predate the outbox.

    manage.py backfill_outbox            # every finding
    manage.py backfill_outbox --batch 500
"""
from django.core.management.base import BaseCommand

from findings.models import Finding
from findings.outbox import emit


class Command(BaseCommand):
    help = "Emit contract v1 outbox rows for existing findings (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--batch", type=int, default=1000)

    def handle(self, *args, **options):
        total = created = failed = 0
        for finding in Finding.objects.select_related("scan").iterator(chunk_size=200):
            total += 1
            try:
                _, was_created = emit(finding)
                created += 1 if was_created else 0
            except Exception as exc:  # keep going, report at the end
                failed += 1
                self.stderr.write(f"finding {finding.pk}: {exc}")
        self.stdout.write(f"scanned {total}, emitted {created}, failed {failed}")
