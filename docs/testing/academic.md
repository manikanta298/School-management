# Module 2: Academic Setup acceptance tests

## Database changes

Migration `002_academic.sql` adds academic_years, terms, classes, sections and subjects with UUID primary keys. Terms/classes reference academic years; sections reference classes. Foreign keys restrict deletion of referenced parents. Names are unique case-insensitively per parent (globally for years and subjects); subject codes are normalized uppercase. A partial unique index permits at most one current year. Date/capacity checks and PostgreSQL triggers keep terms within year dates and reject overlapping terms, including when an academic year is shortened. Parent/name and parent/date indexes support lookups. All application tables through Module 2 are in `backend/database/schema.sql`.

Academic years may overlap, which supports separate academic calendars. Terms within one year may not overlap, and date endpoints are inclusive. Classes belong to a specific year; sections belong to a specific class. Subjects are a school-wide catalog; class/teacher subject assignments will be added with the Teachers module. No enrollment, attendance, fees or exams are implemented here.

## Upgrade

Back up your existing PostgreSQL database. Run the migration against the same database used for Auth; do not load schema.sql over it.

Development:
```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Production: use docker-compose.prod.yml instead of docker-compose.dev.yml and arrange your normal deployment maintenance window. Without Docker: from backend, run `npm ci && npm run migrate`, then restart the API; from frontend, run `npm ci && npm run build` and publish the rebuilt assets.

## API

Base path: `/api/academic`. Resources: `academic-years`, `terms`, `classes`, `sections`, `subjects`.

| Method | Path | Permission / response |
|---|---|---|
| GET | /:resource?limit=25&offset=0 | Any authenticated role; `{items: [...]}` |
| GET | /:resource/:id | Any authenticated role; `{item: ...}` |
| POST | /:resource | Admin; full JSON body; 201 `{item: ...}` |
| PUT | /:resource/:id | Admin; full replacement body; 200 `{item: ...}` |
| DELETE | /:resource/:id | Admin; 204; 409 for dependent records |

List requests accept limit 1–100 and nonnegative offset. Terms/classes support academic_year_id; sections support class_id. Results are ordered by name and ID. Missing record gives 404, invalid input gives 400, duplicates/current-year/reference conflicts give 409. Unknown body fields are rejected. Reads require JWT Authorization header; writes require admin on the server as well as the UI.

| Resource | JSON fields |
|---|---|
| academic-years | name, start_date, end_date, is_current (optional, defaults false) |
| terms | name, academic_year_id, start_date, end_date |
| classes | name, academic_year_id |
| sections | name, class_id, capacity (integer 1–500) |
| subjects | name, code (1–20 letters/digits/underscore/hyphen) |

Dates use YYYY-MM-DD. Invalid calendar dates and reversed ranges are rejected. Names are trimmed, 1–100 characters, and cannot contain control characters or HTML angle brackets. Subject codes are trimmed and uppercased. SQL identifiers come from a fixed server allowlist, and all submitted values are parameterized.

## Browser and PostgreSQL checklist

1. Run migrations twice: both succeed and schema_migrations contains exactly one 002_academic.sql row. Existing Auth accounts still work. Inspect tables/constraints using psql `\d academic_years`, `\d terms`, `\d classes`, `\d sections`, `\d subjects`.
2. As admin, open Academic setup. Create a year named 2026–2027, dates 2026-06-01 to 2027-05-31, mark current. Create another year without marking current. Marking both current returns a conflict. To switch, edit the old year to clear current, then mark the new year current.
3. Create Term 1: 2026-06-01 to 2026-09-30. Attempt another term starting 2026-09-30: reject overlap (inclusive endpoints). Create Term 2 starting 2026-10-01: succeeds. Reject dates outside the year. Editing the year to exclude an existing term also fails.
4. Create Grade 1 under the year, then section A with capacity 30. Edit section to B, capacity 35. Capacity 0, 501 or decimal values fail. The section class picker includes the class's year to distinguish identical names.
5. Create Mathematics with code `math`; display code is MATH. Duplicate codes and duplicate names return 409. Reject `<script>` names and unexpected fields via API.
6. The same class name is allowed under another year; case-only duplicate under the same year fails. Term/section names follow the same per-parent rule. Parent filters return only matching records.
7. Delete a year containing classes or terms: 409. Delete a class containing a section: 409. Delete dependents first; then parents can be deleted. UI asks for confirmation before deletion, and Cancel preserves data.
8. Sign in separately as teacher, student and parent: each can view records, but no create/edit/delete controls appear. Calling write APIs with those accounts returns 403. Signed-out requests return 401.
9. Edit each resource, reload, and confirm persisted values. Confirm loading/error/empty states. Create over 25 subjects to check Previous/Next paging. Parent selectors load all option pages in batches of 100.
10. Invalid UUID gives 400; absent UUID gives 404; unknown resource gives 404. Invalid pagination gives 400. Verify no API responses expose auth secrets.
11. Restart PostgreSQL/API without removing volumes; records persist. Re-run Auth acceptance tests to check regression.

Automated tests run real HTTP handlers and SQL in embedded PostgreSQL (PGlite), including migration runner idempotency. Run the above against actual PostgreSQL and a browser before approving Module 3: Students & Parents.

## Git commands

If reproducing the commit locally on top of the Auth branch:
```sh
git switch feature/auth-users
git switch -c feature/academic-setup
git add backend/database backend/src backend/tests frontend/src docs/testing/academic.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add academic setup module"
git push -u origin feature/academic-setup
```

If the branch is already published, use `git fetch origin` and `git switch --track origin/feature/academic-setup` in a clean clone instead. This branch includes Auth; review/merge in dependency order.
