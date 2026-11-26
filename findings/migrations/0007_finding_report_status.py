# The submission trail: a finding needs to remember that it was sent, and when. Kept separate from
# `validated` so the scanner's flag and the human's report can never overwrite each other.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("findings", "0006_finding_program"),
    ]

    operations = [
        migrations.AddField(
            model_name="finding",
            name="report_status",
            field=models.CharField(
                blank=True,
                choices=[("", "Not reported"), ("reported", "Reported")],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="finding",
            name="reported_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
