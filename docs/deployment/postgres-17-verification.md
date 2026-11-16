# PostgreSQL 17 verification and environment readiness

This project uses PostgreSQL 17 and the Node.js `pg` driver. Database linking is intentionally an operator-owned step: do not place a production connection string in Git, issues, pull requests, or chat.

## Required environment

Backend configuration is read from `backend/.env` (copy `backend/.env.example`). Set:

- `NODE_ENV`: `development` locally; `production` in deployment.
- `PORT`: API listen port (default project setup: 4000).
- `DATABASE_URL`: PostgreSQL connection string for the target environment.
- `JWT_SECRET`: unique cryptographically random secret, at least 48 characters.
- `FRONTEND_ORIGIN`: exact browser origin allowed by CORS and refresh/logout origin checks.
- `TRUST_PROXY`: keep `0` for direct local development; configure only for the actual trusted reverse-proxy topology.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: one-time initial administrator seed settings. Use a unique strong password and remove the bootstrap password from deployment configuration after seeding.

For managed PostgreSQL with TLS, use the existing `DATABASE_CA_CERT` or `DATABASE_CA_CERT_FILE` configuration. Keep certificate verification enabled. Never use `rejectUnauthorized: false` to work around a certificate error.

## Local PostgreSQL 17 with Docker

From the repository root:

```sh
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL,
# ADMIN_PASSWORD, ADMIN_NAME and FRONTEND_ORIGIN.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm ci
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run seed:admin
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Do not run `schema.sql` on a database already managed by migrations. The migration runner records applied migration names and serializes migration execution.

## Verification commands

Run these against a disposable local PostgreSQL 17 database, never a production database:

```sh
cd backend
npm ci
npm test
POSTGRES_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:postgres
cd ../frontend
npm ci
npm test
npm run build
```

On PowerShell, set the test variable with:

```powershell
$env:POSTGRES_TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres"
npm run test:postgres --prefix backend
```

The PostgreSQL integration script refuses non-local hostnames, creates a uniquely named temporary schema, applies the complete migration directory inside it, exercises the transport-capacity race, and drops that schema on exit. Use a disposable database because the script requires schema-creation privileges and performs cleanup.

## Before connecting a school database

1. Confirm PostgreSQL major version 17 and take a verified backup.
2. Confirm the target database and account are dedicated to this application.
3. Confirm TLS and CA verification for remote providers.
4. Confirm the connection role has only the privileges required by migrations and the application.
5. Review pending migration names and the migration/rollback plan.
6. Confirm the first school's existing records and tenant ownership mapping.
7. Apply migrations only after the database owner approves the target and maintenance window.
8. Run smoke tests with a non-production test account and verify school isolation.
9. Verify backup restoration and record the recovery procedure.

No command in this guide automatically links or modifies the user's production database.
