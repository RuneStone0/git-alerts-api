from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("findings", "0007_finding_report_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="finding",
            name="human_verdict",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "No claim"),
                    ("detector_wrong", "Detector was wrong"),
                    ("not_ours", "Not this org's credential"),
                    ("not_reportable", "Real, not reportable here"),
                ],
                default="",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="finding",
            name="human_reason",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="finding",
            name="human_note",
            field=models.CharField(blank=True, default="", max_length=512),
        ),
        migrations.AddField(
            model_name="finding",
            name="human_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
