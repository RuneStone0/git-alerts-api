from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("findings", "0008_finding_human_verdict"),
    ]

    operations = [
        migrations.CreateModel(
            name="FindingOutbox",
            fields=[
                ("seq", models.BigAutoField(primary_key=True, serialize=False)),
                ("finding_id", models.CharField(max_length=64)),
                ("contract_version", models.IntegerField(default=1)),
                ("payload", models.JSONField()),
                ("emitted_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["seq"],
                "unique_together": {("finding_id", "contract_version")},
            },
        ),
    ]
