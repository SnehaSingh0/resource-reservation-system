# Resource Reservation System

## Project Overview

The Resource Reservation System is a web-based application designed to manage the reservation of shared resources such as rooms, equipment, meeting spaces, or other bookable resources.

The application is being developed in stages, starting with the frontend interface and user/admin workflows. Backend services, database integration, authentication, and SSO can be added in the later stage.

---

## Current Stage: Frontend Demo

The current version is a **frontend-only demo** created to complete and review the screens, pages, navigation, reservation flow, resource availability, and admin functionality before backend development.

### Admin Preview

For the current frontend stage, the application uses a temporary **Admin Preview** option on the Login page.

This is only for reviewing the Admin screens during development. It is **not real Admin authentication** and does not represent the final login mechanism.

In the final application:

* There will be one common Login page.
* Users will log in using their credentials.
* The backend will verify the account and its role.
* `USER` accounts will be directed to the User area.
* `ADMIN` accounts will be directed to the Admin area.
* Admin accounts will be created and managed through Admin Management.
* Authentication, authorization, database integration, and SSO can be implemented with the backend.

---

## What Has Been Completed

### 1. User Interface

The User side includes:

* Login page
* Registration page
* Resource selection
* Resource availability calendar
* Month, Week, and Day calendar views
* Date and time selection
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

---

### 4. Admin Interface

The Admin side includes:

* Admin Dashboard
* Manage Reservations
* Manage Resources
* Add Resource
* Edit Resource
* Resource Availability Constraints
* Manage Admins
* Add Admin
* Delete Admin
* User Area access

The Admin interface is kept within the same application as the User interface.

The current Admin Preview is only a temporary way to review these pages before backend authentication is implemented.

---

## Login and Role Design

The planned authentication flow uses a single Login page rather than separate User and Admin login pages.

### Final planned flow

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

The current frontend does not yet contain real backend authentication or role verification.

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
  +--> Manage Admins
          |
          +--> Add Admin
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
* `/admin/admins` — Manage Admins
* `/admin/admins/add` — Add Admin

Some additional routes redirect to the main User or Admin pages for easier navigation.

---

## Technology Stack

### Current Frontend

* React
* TypeScript
* Vite
* React Router
* CSS

### Planned Backend

The backend technology and database can be finalized after the frontend workflow and requirements are reviewed.

The planned architecture separates:

1. Presentation Layer
2. Application / Business Logic Layer
3. Data Layer

---

## Planned 3-Tier Architecture

The final application is intended to follow a 3-tier architecture:

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

The exact database schema will be finalized during backend development.

---

## Why the Application Is Being Developed in Stages

The project is being developed step-by-step rather than building the complete system at once.

### Stage 1 — Frontend

Complete:

* Screens
* Pages
* Navigation
* User flow
* Admin flow
* Calendar interaction
* Resource constraints
* Reservation interface

### Stage 2 — Backend

Add:

* APIs
* Business logic
* Authentication
* Authorization
* Reservation validation

### Stage 3 — Database

Add persistent storage for:

* Users
* Resources
* Reservations
* Constraints
* Roles

### Stage 4 — Authentication / SSO

After the basic system is working, SSO and organization-level authentication can be integrated.

---

## Important Design Decisions

### One Application

User and Admin interfaces are part of the same application.

They are not separate applications.

### One Login

The final system will use one common Login page.

The user's role will determine which area they can access.

### Admin Preview

The Admin Preview exists only for the current frontend review stage.

It will be replaced by real role-based authentication after the backend is implemented.

### Generic Resource System

The application is designed as a generic resource reservation system rather than being limited to one organization or one specific resource type.

---

## Deployment

The frontend project is maintained in GitHub and can be deployed as a web application for review.

The current deployment is intended to allow the completed frontend screens and workflows to be reviewed before backend development.

---

## Current Project Status

**Frontend:** Completed for current review stage

**User Pages:** Completed

**Admin Pages:** Completed

**Calendar UI:** Completed

**Resource Constraints UI:** Completed

**Login / Registration UI:** Completed

**Profile / Logout UI:** Completed

**Backend:** Not implemented yet

**Database:** Not implemented yet

**Real Authentication:** Not implemented yet

**SSO:** Planned for a later stage

---

## Project Goal

The goal is to develop a scalable Resource Reservation System where users can view resource availability and make reservations, while authorized administrators can manage resources, reservations, availability constraints, and administrator accounts.

The system is being designed so that the frontend, backend, and database can be developed as separate layers and connected through a clear application architecture.
