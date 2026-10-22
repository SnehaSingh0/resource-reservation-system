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

The CSRF endpoint returns a masked `csrfToken` in its JSON response and sets the CSRF cookie. Cross-origin frontends should send that token in the `X-CSRFToken` header and include credentials so the browser sends the backend's CSRF and session cookies.

With `DEBUG=true`, local development defaults trust Vite origins on `localhost` and `127.0.0.1` ports 5173–5199, covering Vite's automatic port increments. If `CORS_ALLOWED_ORIGINS` or `CSRF_TRUSTED_ORIGINS` is explicitly set, include the exact frontend origin there. Production must continue to use exact HTTPS origins.

### Resources

- `GET /api/resources/`
- `POST /api/resources/`
- `GET /api/resources/<id>/`
- `PUT /api/resources/<id>/`
- `DELETE /api/resources/<id>/`
- `GET /api/resources/<id>/availability/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
- `GET /api/resources/constraints/` — list constraints for all resources in one authenticated request
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

- `GET /api/users/` — list users and their assigned roles (admin only)
- `POST /api/users/` — create a user (admin only; requires a supported `role`)
- `GET /api/admin/reservations/`
- `DELETE /api/admin/reservations/<id>/`
- `GET /api/admins/` — list administrator accounts
- `POST /api/admins/` — create an administrator account (backward-compatible endpoint)
- `GET /api/admins/<id>/` — read an administrator account
- `PUT /api/admins/<id>/` — update email, name, and phone without changing role or password
- `DELETE /api/admins/<id>/`

User creation accepts only the roles defined by the user model. The role must be provided explicitly; the API does not default new managed accounts to administrator. Passwords are validated and hashed by Django.

## Business rules

- Resource constraints define allowed booking windows.
- A weekly constraint marked `is_full_day: true` makes that weekday available for date-only bookings.
- A full-day reservation sets `is_full_day: true`, omits `start_time` and `end_time`, and reserves every date from `reservation_date` through `end_date` inclusively. Every covered date must allow full-day booking.
- Timed reservations continue to use `start_time` and `end_time`; the backend validates availability and conflicts for each affected date.
- Reservations represent occupied periods.
- Overlapping time windows for the same resource are rejected.
- Reservation updates and cancellations must respect ownership or admin authorization.
- Deleting a reservation permanently removes its record. Deleting a resource permanently removes its availability constraints and reservations through the model's cascading foreign keys; the admin interface confirms this impact before sending the delete request.
- The administrator reservation list includes only confirmed or pending reservations that have not yet ended. Past records remain in the database until their owning reservation or resource is explicitly deleted.
- The database row for a resource is locked during reservation creation/update to reduce double-booking risk.

## Implementation order used

1. Set up the Django project and app skeleton.
2. Define authentication and role-based user models.
3. Add resource, availability, and reservation models.
4. Implement validation and concurrency-safe services.
5. Expose REST endpoints with DRF serializers and permissions.
6. Validate the backend with Django tests and migrations.

## Database configuration

PostgreSQL is the application's default and intended database. The default connection target is database `resource_reservation_db`, role `resource_user`, host `127.0.0.1`, and port `5432`; set `DB_NAME`, `DB_USER`, `DB_HOST`, and `DB_PORT` to override those values. `DB_PASSWORD` is required and Django stops with a configuration error if it is missing. Incorrect credentials are reported by PostgreSQL when Django attempts to connect. `DB_SSLMODE` is also supported; the default is `require` for secure hosted databases. Set `DB_SSLMODE=disable` only for a local PostgreSQL installation that intentionally does not use SSL.

PostgreSQL connections are reused by Django for up to 60 seconds and health-checked when reused. This avoids opening a new database connection for every request while allowing stale connections to be discarded. Each application worker keeps its own connection; this is connection reuse, not a connection pool. SQLite configuration is unchanged.

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

### Temporary request timing diagnostics

To temporarily measure request and database timing, set `REQUEST_TIMING_ENABLED=true` in the backend service's environment (for example, Render's service environment variables) and redeploy. The diagnostic is disabled by default and does not require or enable `DJANGO_DEBUG`. Request logs contain the HTTP method, resolved URL route template, response status, total Django time, SQL query count, and aggregate SQL execution time. GET requests to `/api/resources/` additionally log each SQL statement with its individual execution duration; SQL literals, comments, and parameters are omitted from these statements. Login requests also produce separate `authenticate()` and `login()` phase timings. When enabled, DRF session authentication is timed, and GET requests to `/api/resources/`, `/api/admins/`, and `/api/admin/reservations/` log handler and serializer-data durations. Serializer-data timing is nested within handler timing and may include lazy queryset evaluation; do not add the two values. Handler timers end when the view method returns and do not include later DRF response rendering. If a handler raises an exception that DRF converts to an HTTP response, its phase log reports `status=exception`; only the outer request timing log reports the final HTTP status. Connection acquisition is not separately timed: Django's cursor call ensures a connection before the SQL execute wrapper runs, and safely timing the backend-specific open sequence would require invasive instrumentation. Route templates omit dynamic path values, and query strings are not logged. Request/response bodies, headers, cookies, credentials, and user identifiers are not logged.

Example log fields: `method=POST path=/api/auth/login/ status=200 duration_ms=4500.00 sql_query_count=4 sql_duration_ms=120.00`, with additional lines `login_phase=authenticate duration_ms=...` and `login_phase=login duration_ms=...`. SQL duration measures execution time inside Django's database cursor wrapper; it does not include connection establishment time. Compare the request `duration_ms` with the summed SQL duration and login phase timings to see where time is spent, then compare with browser waiting time to identify time outside Django, such as platform queueing, connection setup, or network transfer.

After collecting enough samples, disable the diagnostic by removing `REQUEST_TIMING_ENABLED` or setting it to `false`, then redeploy. It can also be removed by deleting the login timing instrumentation, `reservations.middleware.RequestTimingMiddleware` and its registration, logger configuration, tests, and this section.

The frontend must build with `VITE_API_BASE_URL` set to the HTTPS API base ending in `/api`. Because login uses cross-origin session cookies, the backend CORS and CSRF origin lists must match the browser-facing frontend origin. Configure the production database's networking and application-role grants before starting the app; do not run migrations as an implicit startup operation.

Run the full backend test suite from this directory with `python manage.py test`. The default database is PostgreSQL; Django creates a temporary test database, so the configured PostgreSQL role must be allowed to create it. PostgreSQL-specific tests are skipped when SQLite is explicitly selected and cannot be counted as PostgreSQL validation.
