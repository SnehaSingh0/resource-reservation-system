# Resource Reservation System

## Project Overview

The Resource Reservation System is a React and Django application for booking shared resources such as rooms and equipment. The React interface calls a Django REST API that owns authentication, role-based authorization, resource availability, reservation validation, and persistence. PostgreSQL is the intended application database.

The frontend and backend are separate deployable applications. Authentication uses Django sessions and CSRF protection; standard registration creates user accounts, while administrator accounts are managed through protected admin functionality. SSO is not implemented.

## Local Development

### Frontend

1. Install the Node.js dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and adjust `VITE_API_BASE_URL` only if the local API differs from `http://localhost:8000/api`.
3. Start Vite with `npm run dev`; create a production build with `npm run build`; run frontend regression tests with `npm test`.

Vite loads `.env.local` automatically. Production builds must define `VITE_API_BASE_URL` in the hosting provider's build environment; otherwise API requests fail with an explicit configuration error rather than targeting localhost.

### Backend

Install the packages listed in `backend/requirements.txt`, configure PostgreSQL connection values and `DB_PASSWORD` in the process environment, then run `python manage.py check`, `python manage.py migrate`, and `python manage.py runserver` from `backend`. The detailed Windows credential setup and production environment settings are documented in [backend/README.md](./backend/README.md). Django does not automatically load `.env` files.

Run backend tests with `python manage.py test` from `backend`; the configured default is PostgreSQL, and the database must be reachable with the configured role. SQLite is only an explicit isolated-test/local option and does not prove PostgreSQL behavior.

Never commit passwords, database credentials, or production Django secret keys. Put deployment secrets in the host's secret/environment configuration.

---

## What Has Been Completed

### 1. User Interface

The User side includes:

* Login page
* Registration page
* Resource selection
* Resource availability calendar
* Month, Week, and Day calendar views
* Date and time selection, including date-only full-day bookings when every selected date is configured for full-day availability
* Reservation summary
* My Reservations page
* Reservation cancellation
* Profile menu
* Logout

The calendar is designed around a Google Calendar-style reservation experience.

---

### 2. Resource Availability

The reservation interface distinguishes between:

* Available time
* Booked time
* Unavailable time
* Selected time

Week and Day views support selecting a continuous time range.

The system is designed so that a user cannot select a time range that crosses booked or unavailable periods.

For example, if a resource is available from 09:00 to 18:00 and another reservation exists from 11:00 to 13:00, the user can select:

* 09:00–11:00
* 13:00–18:00

but cannot select 10:00–14:00.

---

### 3. Resource Constraints

Each resource can have its own availability constraints.

For example:

* Monday: 09:00–18:00
* Tuesday: 10:00–17:00
* Wednesday: unavailable

These constraints represent when a resource **can be reserved**.

They are different from reservations, which represent time periods that are already occupied.
An administrator can mark a weekly availability window as full-day; only then can users reserve one or more complete dates without entering times.

---

### 4. Admin Interface

The Admin side includes:

* Admin Dashboard
* Manage Reservations
* Manage Resources
* Add Resource
* Edit Resource
* Resource Availability Constraints
* Manage administrator accounts
* Add and edit administrator details
* Delete Admin
* User Area access

The Admin interface is kept within the same application as the User interface.

Administrator routes and API operations require an authenticated account with the administrator role.

---

## Login and Role Design

The application uses a single Login page rather than separate User and Admin login pages.

### Authentication flow

```text
Login
  |
  v
Backend verifies credentials
  |
  +---- USER ----> User Area
  |
  +---- ADMIN ---> Admin Dashboard
```

Normal registration will create User accounts.

Admin accounts will be managed by authorized administrators through the Admin Management section.

The backend verifies credentials and enforces role and ownership permissions.

---

## Profile and Logout

A profile/avatar menu is available in the application.

The menu contains:

* Profile
* Logout

Logout returns the user to the Login page.

This same navigation approach is intended for both User and Admin areas.

---

## Functional Flow

### User Flow

```text
Login / Register
       |
       v
Resource Selection
       |
       v
View Availability
       |
       v
Select Date and Time
       |
       v
Reservation Summary
       |
       v
Reserve
       |
       v
My Reservations
```

### Admin Flow

```text
Login
  |
  v
Admin Dashboard
  |
  +--> Manage Reservations
  |
  +--> Manage Resources
  |       |
  |       +--> Add Resource
  |       +--> Edit Resource
  |       +--> Availability Constraints
  |
  +--> Manage Users
          |
          +--> Add User
          +--> Delete Admin
```

---

## Current Routes

### User Routes

* `/login` — Login
* `/register` — Registration
* `/resources` — Resource Reservation
* `/my-reservations` — My Reservations

### Admin Routes

* `/admin` — Admin Dashboard
* `/admin/reservations` — Manage Reservations
* `/admin/resources` — Manage Resources
* `/admin/resources/add` — Add Resource
* `/admin/resources/edit?resourceId=<resource-id>` — Edit Resource / Availability Constraints
* `/admin/admins` — Manage administrator accounts
* `/admin/admins` — Manage Users and roles
* `/admin/admins/add` — Add User

Some additional routes redirect to the main User or Admin pages for easier navigation.

---

## Technology Stack and Architecture

* Frontend: React 18, TypeScript, Vite, React Router, CSS.
* Backend: Django REST Framework with session authentication and CSRF protection.
* Database: PostgreSQL is the intended application database and Django's default.
* Backend configuration: environment variables; Django does not load `.env` files.
* Deployment: frontend and backend are deployed separately and communicate over the configured API URL.

The application follows a three-tier architecture:

```text
                User / Browser
                      |
                      v
          Presentation Layer
             React Frontend
                      |
                      v
          Application Layer
       Backend / Business Logic
                      |
                      v
               Data Layer
             Database
```

### Presentation Layer

Responsible for:

* UI
* Pages
* Navigation
* Calendar
* User interactions

### Application Layer

Responsible for:

* Authentication
* Authorization
* Reservation rules
* Availability validation
* Conflict checking
* Resource management
* Admin operations

### Data Layer

Responsible for storing:

* Users
* Admins / roles
* Resources
* Resource constraints
* Reservations

The Django models and migrations define users and roles, resources, availability constraints, and reservations. Reservation validation and database concurrency handling are implemented by the backend.

---

## Important Design Decisions

### One Application

User and Admin interfaces are part of the same application.

They are not separate applications.

### One Login

The system uses one common Login page.

The user's role determines which area they can access, with authorization enforced by backend permissions.

### Generic Resource System

The application is designed as a generic resource reservation system rather than being limited to one organization or one specific resource type.

---

## Deployment

For a deployment, set `VITE_API_BASE_URL` in the frontend hosting provider's build environment. Set `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` on the backend to the deployed hosts, and provide `DJANGO_SECRET_KEY` and PostgreSQL credentials through private backend environment/secret settings. Keep the API on HTTPS. This repository does not provision infrastructure or claim a deployment is currently active.

---

## Current Project Status

**Frontend:** React/TypeScript user and administrator interface implemented

**User Pages:** Implemented

**Admin Pages:** Implemented

**Calendar UI:** Day, Week, and Month views with existing hourly slots and range selection

**Resource Constraints UI:** Implemented

**Login / Registration UI:** Connected to Django session authentication

**Profile / Logout UI:** Connected to backend session flow

**Backend:** Django REST API and role-based permissions implemented

**Database:** PostgreSQL intended/default; connection must be configured per environment

**Authentication:** Session-based login and registration implemented

**SSO:** Not implemented; future work

---

## Project Goal

The goal is to develop a scalable Resource Reservation System where users can view resource availability and make reservations, while authorized administrators can manage resources, reservations, availability constraints, and administrator accounts.

The frontend, backend, and PostgreSQL database operate as separate application layers connected through the REST API.
