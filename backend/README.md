# Resource Reservation System backend

This backend implements the Tier 2 application layer for the existing frontend demo.

## Architecture

- `reservations/models.py`: domain models for users, resources, constraints, and reservations.
- `reservations/services.py`: reservation validation and concurrency-safe business logic.
- `reservations/serializers.py`: validation and API serialization.
- `reservations/views.py`: REST API endpoints and permission checks.

## Final API contract

### Authentication

- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `GET /api/users/me/`
- `GET /api/users/`

The CSRF endpoint returns a masked `csrfToken` in its JSON response and sets the CSRF cookie. Cross-origin frontends should send that token in the `X-CSRFToken` header and include credentials so the browser sends the backend's CSRF and session cookies.

### Resources

- `GET /api/resources/`
- `POST /api/resources/`
- `GET /api/resources/<id>/`
- `PUT /api/resources/<id>/`
- `DELETE /api/resources/<id>/`
- `GET /api/resources/<id>/availability/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
- `GET /api/resources/<id>/constraints/`
- `POST /api/resources/<id>/constraints/`
- `GET /api/resource-constraints/<id>/`
- `PUT /api/resource-constraints/<id>/`
- `DELETE /api/resource-constraints/<id>/`

### Reservations

- `GET /api/reservations/`
- `GET /api/reservations/<id>/`
- `POST /api/reservations/`
- `PUT /api/reservations/<id>/`
- `DELETE /api/reservations/<id>/`

### Admin operations

- `GET /api/admin/reservations/`
- `DELETE /api/admin/reservations/<id>/`
- `GET /api/admins/`
- `POST /api/admins/`
- `DELETE /api/admins/<id>/`

## Business rules

- Resource constraints define allowed booking windows.
- Reservations represent occupied periods.
- Overlapping time windows for the same resource are rejected.
- Reservation updates and cancellations must respect ownership or admin authorization.
- The database row for a resource is locked during reservation creation/update to reduce double-booking risk.

## Implementation order used

1. Set up the Django project and app skeleton.
2. Define authentication and role-based user models.
3. Add resource, availability, and reservation models.
4. Implement validation and concurrency-safe services.
5. Expose REST endpoints with DRF serializers and permissions.
6. Validate the backend with Django tests and migrations.

## Database configuration

PostgreSQL is the application's default and intended database. The default connection target is database `resource_reservation_db`, role `resource_user`, host `127.0.0.1`, and port `5432`; set `DB_NAME`, `DB_USER`, `DB_HOST`, and `DB_PORT` to override those values. `DB_PASSWORD` is required and Django stops with a configuration error if it is missing. Incorrect credentials are reported by PostgreSQL when Django attempts to connect.

Provide `DB_PASSWORD` through a private environment variable or a secret manager. Do not put database passwords in source files, commit them to Git, or assume that a `.env` file is loaded: this project reads process environment variables and does not load `.env` files. `.env` files are ignored by Git if you choose to maintain one locally. In production, configure all connection values and the password through the deployment platform's environment/secret settings.

For example, in PowerShell, set the non-secret connection settings in the shell where Django will run:

```powershell
$env:DB_NAME = "resource_reservation_db"
$env:DB_USER = "resource_user"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "5432"
```

Supply `DB_PASSWORD` separately through your private environment/secret manager before running `python manage.py check`, `python manage.py migrate`, or the application. The command will not silently fall back to another database.

SQLite remains available only as an explicit local/test choice by setting `DB_ENGINE=django.db.backends.sqlite3`. When selected without `DB_NAME`, it uses `backend/db.sqlite3`; set `DB_NAME=:memory:` for isolated in-memory tests. SQLite is not the application default and SQLite test results do not verify PostgreSQL connectivity, privileges, migrations, or PostgreSQL-specific behavior.

### Set a local PostgreSQL password in PowerShell

In the same PowerShell session used to run Django, enter the password at a hidden prompt. This sets the process environment variable without printing or placing the password in a command or source file:

```powershell
$securePassword = Read-Host "PostgreSQL password for resource_user" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Variable securePassword, passwordPointer
}
```

Then, before running migrations or tests, verify the configured target and authentication with:

```powershell
python manage.py check --database default
```

This check attempts the actual PostgreSQL connection. It does not change database data. Do not proceed to `migrate` unless the connection succeeds and the target is the intended database. The password is available to child processes in that PowerShell session; clear it when finished with `$env:DB_PASSWORD = $null`.

### Production settings

Set `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY`, and a comma-separated `DJANGO_ALLOWED_HOSTS` on the backend host. Set `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` to the exact HTTPS frontend origin(s), without trailing slashes. Configure `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT` in the backend host's environment or secret manager. When debug is disabled, secure session and CSRF cookies and HTTPS redirect are enabled, and Django requires a secret key and explicit allowed hosts. Do not expose database credentials or `DJANGO_SECRET_KEY` as frontend/Vite variables.

The frontend must build with `VITE_API_BASE_URL` set to the HTTPS API base ending in `/api`. Because login uses cross-origin session cookies, the backend CORS and CSRF origin lists must match the browser-facing frontend origin. Configure the production database's networking and application-role grants before starting the app; do not run migrations as an implicit startup operation.

Run the full backend test suite from this directory with `python manage.py test`. The default database is PostgreSQL; Django creates a temporary test database, so the configured PostgreSQL role must be allowed to create it. PostgreSQL-specific tests are skipped when SQLite is explicitly selected and cannot be counted as PostgreSQL validation.
