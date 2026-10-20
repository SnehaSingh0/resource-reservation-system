from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reservations", "0002_add_user_timestamps"),
    ]

    operations = [
        migrations.AddField(
            model_name="reservation",
            name="end_date",
            field=models.DateField(blank=True, default=None, null=True),
        ),
    ]
