# Resource Reservation System

A web-based application that allows users to reserve shared resources for specific dates and time slots while enabling administrators to manage resources, reservations, users, and availability constraints.

## Overview

The Resource Reservation System is designed to simplify resource booking and prevent scheduling conflicts. Users can browse available resources, check their availability using a calendar, and create reservations. Administrators can manage resources, configure availability constraints, and oversee user reservations.

The application follows a full-stack architecture using React, Django REST Framework, and PostgreSQL.

## Key Features

### User Features

* User registration and email-based login.
* Browse available resources.
* View resource availability through an interactive calendar.
* Select reservation dates and time slots.
* Support for multi-day and full-day reservations.
* Automatic reservation conflict validation.
* View personal reservations.
* Cancel existing reservations.
* Prevent reservations for past dates and past time slots.

### Admin Features

* Dedicated administrator dashboard.
* Add, edit, and delete resources.
* Manage resource availability constraints.
* View and manage user accounts.
* View and manage reservations.
* Manage administrator accounts.
* Prevent deletion of the last active administrator.

### System Features

* Role-based access control for users and administrators.
* Backend validation of reservation availability.
* Prevention of overlapping reservations.
* PostgreSQL database integration.
* REST API communication between frontend and backend.
* Request caching to reduce unnecessary API calls.
* Responsive user interface.

## Technology Stack

| Layer               | Technology                    |
| ------------------- | ----------------------------- |
| Frontend            | React                         |
| Language            | TypeScript                    |
| Build Tool          | Vite                          |
| Backend             | Python, Django                |
| API                 | Django REST Framework         |
| Database            | PostgreSQL                    |
| Database Adapter    | Psycopg                       |
| Authentication      | Django Authentication         |
| Testing             | Pytest / Django Tests, Vitest |
| Version Control     | Git and GitHub                |
| Frontend Deployment | Vercel                        |
| Backend Deployment  | Render                        |
| Database Hosting    | Neon PostgreSQL               |

## Application Architecture

The application follows a three-tier architecture:

```text
        User / Administrator
                 |
                 v
        React + TypeScript
          (Frontend)
                 |
                 | REST API
                 v
        Django REST Framework
            (Backend)
                 |
                 | Django ORM
                 v
           PostgreSQL
            (Database)
```

### How It Works

1. Users interact with the React frontend.
2. The frontend sends HTTP requests to the Django REST API.
3. Django handles authentication, authorization, business logic, and reservation validation.
4. Django ORM communicates with PostgreSQL using Psycopg.
5. The database stores user accounts, resources, reservations, and availability constraints.
6. The backend returns responses to the frontend, which updates the interface.

## Project Structure

```text
Resource-Reservation-System/
│
├── backend/
│   ├── resource_reservation_backend/
│   ├── reservations/
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   └── user/
│   │   ├── components/
│   │   └── ...
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

*Note: The structure above is a simplified overview.*

## Getting Started

Follow these steps to run the application locally.

### Prerequisites

Install the following:

* Python
* Node.js and npm
* PostgreSQL
* Git

### 1. Clone the Repository

```bash
git clone https://github.com/SnehaSingh0/resource-reservation-system.git
```

```bash
cd resource-reservation-system
```

### 2. Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Create and activate a virtual environment.

**Windows:**

```powershell
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

### 3. Database Configuration

Create a PostgreSQL database and configure the database connection using environment variables.

The backend uses the following database settings:

```env
DB_ENGINE=django.db.backends.postgresql
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_HOST=localhost
DB_PORT=5432
```

Configure the remaining Django environment settings as required by your local setup.

**Important:** Never commit database passwords, secret keys, or other sensitive credentials to GitHub.

### 4. Run Database Migrations

```bash
python manage.py migrate
```

Create an administrator account using the project's configured user-management process.

### 5. Start the Backend Server

```bash
python manage.py runserver
```

The backend will be available at:

`http://localhost:8000/`

### 6. Frontend Setup

Open another terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Configure the frontend API base URL to point to the local Django backend:

```text
http://localhost:8000/api
```

Start the development server:

```bash
npm run dev
```

The frontend will typically be available at:

`http://localhost:5173/`

## Testing

### Backend Tests

From the backend directory:

```bash
python manage.py test
```

Run Django system checks:

```bash
python manage.py check
```

### Frontend Tests

From the frontend directory:

```bash
npm test
```

### Production Build

```bash
npm run build
```

## Deployment

The application is deployed using the following services:

| Component | Hosting Platform |
| --------- | ---------------- |
| Frontend  | Vercel           |
| Backend   | Render           |
| Database  | Neon PostgreSQL  |

The frontend communicates with the deployed backend through the configured API base URL.

The backend connects to the PostgreSQL database using environment-based database configuration.

Production credentials and secret configuration are maintained through deployment environment variables.

## Security and Validation

The application implements:

* Role-based authorization.
* Backend-side reservation validation.
* Prevention of overlapping reservations.
* Validation against past reservation dates and times.
* Protected administrative operations.
* Environment-based database credentials.

## Future Improvements

Potential areas for further development include:

* Enhanced mobile calendar experience.
* Improved administrator search and filtering.
* Further application performance optimization.
* Additional reporting and reservation analytics.
* Implement Single Sign-On (SSO) for simplified and centralized user authentication
## Author

**Sneha Singh**

B.Tech – Computer Science and Engineering

GitHub: [SnehaSingh0](https://github.com/SnehaSingh0)

---

*Resource Reservation System – A full-stack application for efficient resource booking and management.*
