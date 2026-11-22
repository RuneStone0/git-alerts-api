import hashlib

from django.db import migrations, models
import django.db.models.deletion


def fill_fingerprints(apps, schema_editor):
    Finding = apps.get_model("findings", "Finding")
    seen = {}
    for finding in Finding.objects.all().order_by("id"):
        raw = "\x1f".join(
            str(part or "")
            for part in (
                finding.repository,
                finding.commit_hash,
                finding.file,
                finding.type,
                finding.value,
            )
        )
        digest = hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()
        # An older duplicate is not fatal: keep the first, drop the later copy.
        if digest in seen:
            finding.delete()
            continue
        seen[digest] = finding.id
        finding.fingerprint = digest
        finding.save(update_fields=["fingerprint"])


class Migration(migrations.Migration):

    dependencies = [
        ("findings", "0004_finding_validated"),
    ]

    operations = [
        migrations.AlterField(
            model_name="finding",
            name="scan",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="findings",
                to="scans.scan",
            ),
        ),
        migrations.AddField(
            model_name="finding",
            name="fingerprint",
            field=models.CharField(max_length=64, null=True, blank=True),
        ),
        migrations.RunPython(fill_fingerprints, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="finding",
            name="fingerprint",
            field=models.CharField(max_length=64, unique=True),
        ),
    ]
