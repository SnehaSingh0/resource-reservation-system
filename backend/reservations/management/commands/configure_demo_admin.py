import getpass
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction


class Command(BaseCommand):
    help = "Create or update the development demo administrator account."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "This command is available only when Django DEBUG is enabled."
            )

        email = os.environ.get("DEMO_ADMIN_EMAIL") or input("Admin email: ").strip()
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError(f"Invalid Admin email: {' '.join(exc.messages)}") from exc

        password = os.environ.get("DEMO_ADMIN_PASSWORD")
        if not password:
            password = getpass.getpass("Admin password: ")
            password_confirmation = getpass.getpass("Confirm Admin password: ")
            if password != password_confirmation:
                raise CommandError("The passwords did not match.")
        if not password:
            raise CommandError("An Admin password is required.")

        User = get_user_model()
        with transaction.atomic():
            matches = list(User.objects.select_for_update().filter(email__iexact=email))
            if len(matches) > 1:
                raise CommandError(
                    "Multiple accounts match this email ignoring case; resolve the duplicate accounts first."
                )
            if matches:
                admin = matches[0]
                created = False
            else:
                username = self._available_username(User, email)
                admin = User(username=username, email=email)
                created = True

            try:
                validate_password(password, user=admin)
            except ValidationError as exc:
                raise CommandError(f"Invalid Admin password: {' '.join(exc.messages)}") from exc

            admin.email = email
            admin.role = User.ROLE_ADMIN
            admin.is_active = True
            admin.set_password(password)
            admin.save()

        action = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(f"{action} development Admin account for {email}.")
        )

    @staticmethod
    def _available_username(user_model, email):
        base = email.split("@", 1)[0][:150] or "demo-admin"
        username = base
        suffix = 1
        while user_model.objects.filter(username=username).exists():
            suffix_text = str(suffix)
            username = f"{base[:150 - len(suffix_text)]}{suffix_text}"
            suffix += 1
        return username
