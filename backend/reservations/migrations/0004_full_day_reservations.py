from datetime import time

from django.db import migrations, models


def mark_existing_full_day_schedules(apps, schema_editor):
    AvailabilityConstraint = apps.get_model(
        "reservations", "ResourceAvailabilityConstraint"
    )
    AvailabilityConstraint.objects.filter(
        is_active=True,
        start_time=time(0, 0),
        end_time=time(23, 59),
    ).update(is_full_day=True)


class Migration(migrations.Migration):
    dependencies = [
        ("reservations", "0003_reservation_end_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="resourceavailabilityconstraint",
            name="is_full_day",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="reservation",
            name="is_full_day",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name="reservation",
            name="start_time",
            field=models.TimeField(blank=True, default=None, null=True),
        ),
        migrations.AlterField(
            model_name="reservation",
            name="end_time",
            field=models.TimeField(blank=True, default=None, null=True),
        ),
        migrations.RunPython(
            mark_existing_full_day_schedules,
            migrations.RunPython.noop,
        ),
    ]
