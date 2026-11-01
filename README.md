# School Management — React, Express and PostgreSQL

Modules 1–9: Auth & Users, Academic Setup, Students & Parents, Teachers, Attendance, Fees, Exams & Results, Timetable, and Notices & Dashboards. The application source is separated into `/frontend` (React + Vite) and `/backend` (Node.js + Express), with PostgreSQL migrations in `/backend/database`.

## Requirements

Node.js 24, npm, PostgreSQL 17; or Docker Engine with Docker Compose v2.24.4+ (the dev override uses `!override`).

## Development with Docker

1. Copy `.env.example` to `.env`. Set a random URL-safe POSTGRES_PASSWORD, a unique ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes), and JWT_SECRET. Generate secrets with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Keep FRONTEND_ORIGIN exactly `http://localhost:5173`.
2. Build and start the database:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.dev.yml build
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
   docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
   docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run seed:admin
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```
3. Open http://localhost:5173 and sign in using the administrator credentials you chose.

Seed is idempotent and never overwrites existing credentials. Migrations are transactional, serialized with an advisory lock, and recorded in schema_migrations. Do not run schema.sql on an already migrated database. Use migrations for upgrades; schema.sql is the current application-table snapshot.

## Development without Docker

Create a dedicated PostgreSQL database and user. Copy backend/.env.example to backend/.env and set its values. Keep the same frontend origin. From backend run `npm ci`, `npm run migrate`, `npm run seed:admin`, then `npm run dev`. In another terminal, from frontend run `npm ci` and `npm run dev`. Vite proxies /api to localhost:4000; the browser keeps the refresh cookie on the frontend origin. Optional frontend environment settings are in frontend/.env.example; VITE variables are public and must never contain secrets.

## Production

Set NODE_ENV through Compose (already production), FRONTEND_ORIGIN to your exact HTTPS URL, and generated secrets in `.env`. Configure an HTTPS reverse proxy to forward the site's traffic to `127.0.0.1:8080`; only frontend is published. Never expose backend directly: TRUST_PROXY=1 trusts the single nginx hop, and nginx overwrites X-Forwarded-For. If you change the proxy topology, review trusted proxies and rate limiting. PostgreSQL and backend ports are private in the production configuration.

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run seed:admin
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Back up PostgreSQL before migrations; take regular tested backups of the school_pgdata volume/database. Do not use `down -v` unless intentionally destroying data. Use one API replica with the current in-memory rate limiter; a multi-replica deployment requires a shared limiter store. Set up TLS certificate renewal, monitoring, and database backups before real school use. Remove ADMIN_PASSWORD from deployment environment after bootstrap. Use TLS with verified certificates for a remote database (node-postgres connection-string SSL configuration). Development bind mounts and ports must never be used in production.

## Security and behavior

Passwords use bcrypt cost 12; length is checked in UTF-8 bytes to avoid bcrypt truncation. Email is trimmed and normalized; unknown input fields are rejected. Names reject control characters/HTML markup, and React escapes displayed text. All user values use parameterized queries. Access JWTs last 15 minutes and remain only in browser memory. Refresh tokens are random, stored as SHA-256 hashes, rotated on use, and live in HttpOnly SameSite=Strict cookies (Secure in production). Refresh/logout require the exact configured Origin to block CSRF. Refresh replay revokes all sessions for that user. Password change/reset revokes all sessions immediately; authentication checks the live database role and session on every protected request. Logout revokes the current session. Sessions expire after seven days; expired/revoked database records can be periodically purged by a DBA.

There is no public registration. Admins create accounts and can reset passwords after verifying identity, then share credentials through a secure channel. Password reset currently uses the administrator workflow; email recovery is not implemented. Academic Setup adds years, terms, classes, sections and subjects. Students & Parents adds student/parent profiles, family links, and section enrollment. Teachers adds staff profiles, class/subject assignments, and private assignment rosters. Attendance adds daily section registers, audited corrections and scoped reports. Fees adds charge structures, fixed invoices, manual payment records and currency-separated balances. Exams & Results adds candidate registration, subject papers, grading, audited marks and published report cards. Timetable adds weekly section schedules, optional rooms, conflict checks and scoped views. Notices & Dashboards adds targeted announcements, explicit read acknowledgments and live role-specific summaries. All nine approved modules are implemented; browser/PostgreSQL/deployment acceptance remains.

## API

All bodies are JSON. Protected routes require `Authorization: Bearer <accessToken>`. Refresh/logout need the refresh cookie and `Origin: <FRONTEND_ORIGIN>`. Errors have `{message}` and validation errors may include `errors`.

| Method | Path | Access / body |
|---|---|---|
| GET | /api/health | Public liveness |
| POST | /api/auth/login | Public: email, password; returns accessToken, user and refresh cookie |
| POST | /api/auth/refresh | Refresh cookie + trusted Origin; rotates session |
| POST | /api/auth/logout | Refresh cookie + trusted Origin; 204 |
| GET | /api/auth/me | Any signed-in role |
| POST | /api/auth/change-password | Any signed-in role: currentPassword, newPassword |
| GET | /api/users?limit=25&offset=0 | Admin; limit 1–100 |
| POST | /api/users | Admin: name, email, password, role |
| POST | /api/users/:id/reset-password | Admin: newPassword; 204 |

Roles: admin, teacher, student, parent. See `docs/testing/auth.md` for acceptance steps.

## Checks

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

The API tests execute the actual SQL schema and HTTP handlers against PGlite (embedded PostgreSQL); they do not replace Docker/PostgreSQL acceptance testing. Test credentials are test-only. Docker and browser acceptance checks need to be run in an environment with those facilities.

## Commit this module

Run from the repository root after reviewing `git diff` and testing:

```sh
git switch -c feature/auth-users
git add frontend backend docs README.md .env.example .gitignore .dockerignore docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml
git diff --cached --stat
git commit -m "feat: add authentication and user management module"
git push -u origin feature/auth-users
```

Never force-add .env or commit real credentials. Dependencies are locked separately in each app. Academic Setup is implemented in Module 2; see its migration and testing instructions below.

## Module 2: Academic Setup

Admins manage academic years, terms, classes, sections and the subject catalog from Academic setup. All authenticated roles can view them. Run migration 002_academic.sql using `npm run migrate`; do not re-import schema.sql. Full schema is kept current through Module 9. See [upgrade steps, API reference, acceptance checklist and git commands](docs/testing/academic.md). Module 3 is implemented below.

## Module 3: Students & Parents

Admins manage student/parent profiles, family links and yearly section enrollment. Students see only their own records; parents see only linked children and their own parent profile. Teachers use dedicated assignment roster endpoints; student/parent profile APIs remain private. Run `npm run migrate` to apply 003_students_parents.sql. See [schema details, API reference, upgrade steps, acceptance tests and git commands](docs/testing/students-parents.md). Module 4 is implemented below.

## Module 4: Teachers

Admins manage teacher profiles, class-teacher and subject-teacher assignments. Teachers see only their own profiles, assignments, and active student rosters for their assigned classes; private student/family data is excluded. Inactive employment or removed assignments revoke roster access. Run `npm run migrate` to apply 004_teachers.sql. See [schema changes, API reference, upgrade steps, acceptance tests and git commands](docs/testing/teachers.md). Module 5 is implemented below.

## Module 5: Attendance

Admins and active class teachers mark daily section registers; subject teachers have read access to assigned classes. Students and parents read only their authorized histories. Version checks prevent lost updates, corrections require reasons, and audit history is retained. Run `npm run migrate` for 005_attendance.sql. See [schema changes, API reference, school-date configuration, upgrade steps, testing checklist and git commands](docs/testing/attendance.md). Module 6 is implemented below.

## Module 6: Fees

Admins manage class/year fee structures, issue invoices and manually record or reverse payments. Students and parents see only their authorized invoices, receipts and balances. Money uses integer minor units, invoices preserve charge snapshots, and retry keys/audit events protect payment records. No online payment processing or bank refunds occur. Run `npm run migrate` for 006_fees.sql. See [schema changes, API reference, upgrade steps, testing checklist and git commands](docs/testing/fees.md). Module 7 is implemented below.

## Module 7: Exams & Results

Admins set up exams, grading scales, papers and candidates. Subject teachers enter versioned marks; class teachers preview full results. Only complete, published results are visible to authorized students/parents. Reopening hides results until audited corrections are republished. Run `npm run migrate` for 007_exams.sql. See [schema changes, grading rules, API reference, upgrade steps, testing checklist and git commands](docs/testing/exams.md). Module 8 is implemented below.

## Module 8: Timetable

Admins create date-limited weekly section sessions using subject-teacher assignments and optional rooms. Database guards reject teacher/section/room conflicts across real occurrences and overlapping years. Teachers see their own sessions; students/parents see their current authorized sections. Versioned edits, inactive history and audits preserve replacements. Run `npm run migrate` for 008_timetable.sql. See [schema changes, API reference, teacher-replacement workflow, upgrade steps, testing checklist and git commands](docs/testing/timetable.md). Module 9 is implemented below.

## Module 9: Notices & Dashboards

Admins draft, target, schedule, publish and archive in-app notices. Read acknowledgments are content-version specific, with retained history. Login now opens a role-scoped dashboard with coherent source-module counts, balances, sessions and notices. No external messages are sent. Run `npm run migrate` for 009_notices.sql. See [schema changes, API reference, audience/lifecycle rules, upgrade steps, final acceptance checklist and git commands](docs/testing/notices-dashboards.md). All nine modules are implemented; final acceptance, merge and deployment are separate steps.

## Render deployment

For missing environment settings during Render startup, follow [the Render setup guide](docs/deployment/render.md). The root `render.yaml` supplies a backend Blueprint; existing services require their environment values to be set in the Render dashboard.
