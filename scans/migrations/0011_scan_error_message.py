from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scans", "0010_alter_scan_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="scan",
            name="error_message",
            field=models.TextField(blank=True, default=""),
        ),
    ]
