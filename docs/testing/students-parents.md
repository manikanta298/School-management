# Module 3: Students & Parents

## Scope and database changes

Migration `003_students_parents.sql` adds:

| Table | Purpose and constraints |
|---|---|
| students | One profile per student-role user; unique uppercase admission number; admission date, optional birth date/address |
| parents | One profile per parent-role user; optional phone/address |
| student_parents | Many-to-many family links; composite primary key; relationship mother/father/guardian/other |
| enrollments | One placement per student per academic year; section, class, enrollment date and active/withdrawn/completed status |

Every new table has a primary key. Foreign keys restrict deletion of referenced accounts, profiles, years, classes and sections. Composite foreign keys enforce the account's role and the enrollment's year/class/section consistency. Indexed student/parent links support family lookups; enrollment indexes cover student/year uniqueness and section/status, class/year and year filters.

Database triggers serialize enrollment checks using row locks and enforce section capacity, dates within the academic year, and enrollment on or after student admission. A section's capacity cannot be reduced below its active enrollment count. Academic years cannot be shortened to exclude existing enrollments; admission cannot be moved after an existing enrollment. Birth date cannot follow admission; admission cannot be in the future. PostgreSQL DATE values stay YYYY-MM-DD strings instead of being converted to timezone-dependent timestamps.

Profiles reuse names/emails from Auth accounts. Their account association is immutable through profile update APIs. Deleting a profile retains its login account. Linked/enrolled profiles must have their dependent records removed before deletion. Prefer withdrawn/completed enrollment status to preserve records. Enrollment edits replace the placement for that year: section-transfer history and audit logs are not implemented. Deletion is intended for erroneous records and is permanent.

## Permissions

| Role | Students / enrollments | Parent profiles | Family links | Writes |
|---|---|---|---|---|
| admin | All | All | All | All module operations |
| student | Own record only | No access | Own guardian names/relationships | None |
| parent | Linked children only | Own profile only | Own link for an authorized child | None |
| teacher | No access yet | No access | No access | None |

Teachers will receive assignment-based access in the Teachers module. Unauthorized individual record IDs return 404, so changing IDs does not reveal other families. Parent/student responses never include password hashes or account roles from profile storage. Guardian lists expose names/relationships, not email, phone or address. Unlinking a parent immediately removes access to that child. Family information responses use Cache-Control: no-store.

## Upgrade

Back up PostgreSQL first. On the same database used for Modules 1–2:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Production uses docker-compose.prod.yml instead of docker-compose.dev.yml; use your normal deployment maintenance window. Without Docker, run `npm ci && npm run migrate` from backend, restart the API, and run `npm ci && npm run build` from frontend. Publish the rebuilt frontend assets. Do not run schema.sql over an existing database: it is the complete fresh-schema reference through Module 3, while numbered migrations perform upgrades.

Existing accounts/data remain in place. There is no automatic profile creation or conversion of legacy Laravel data. No new secrets or environment variables are required.

## API

All requests require a JWT. All writes require admin. Request bodies are strict JSON; extra keys are rejected. Profile lists support limit (1–100, default 25), offset (nonnegative, default 0) and q (literal case-insensitive name/email search, plus admission number for students). Student lists additionally support parent_id, academic_year_id and section_id. Enrollment filters include all statuses. Every filter is combined with the caller's access scope; filters never expand permission. Nested lists support limit/offset. Profile/enrollment PUT requests replace editable fields; account IDs cannot be changed.

| Method | Path | Body / response |
|---|---|---|
| GET | /api/students | Scoped `{items: [...]}` |
| GET | /api/students/:id | Scoped `{item: ...}` |
| POST | /api/students | user_id, admission_number, admission_date; optional date_of_birth/address; 201 |
| PUT | /api/students/:id | admission_number, admission_date; optional date_of_birth/address |
| DELETE | /api/students/:id | 204; referenced profile gives 409 |
| GET | /api/parents | All for admin; own for parent; `{items: [...]}` |
| GET | /api/parents/:id | Scoped `{item: ...}` |
| POST | /api/parents | user_id; optional phone/address; 201 |
| PUT | /api/parents/:id | optional phone/address |
| DELETE | /api/parents/:id | 204; linked profile gives 409 |
| GET | /api/students/:id/parents | Scoped `{items: [...]}` |
| POST | /api/students/:id/parents | parent_id, relationship; 201 |
| DELETE | /api/students/:id/parents/:parentId | 204; unlink |
| GET | /api/students/:id/enrollments | Scoped `{items: [...]}` |
| POST | /api/students/:id/enrollments | academic_year_id, section_id, enrolled_on; optional status (default active); 201 |
| PUT | /api/students/:id/enrollments/:enrollmentId | Same fields; update placement/status |
| DELETE | /api/students/:id/enrollments/:enrollmentId | 204; permanently remove erroneous enrollment |

Dates use real YYYY-MM-DD calendar dates. Admission numbers are trimmed, uppercased and limited to 1–30 letters/digits/underscore/hyphen. Addresses are nullable and limited to 500 characters, with markup/control characters rejected. Phone is nullable and otherwise 7–30 characters using digits, +, spaces, parentheses, dots and hyphens. Omitted optional fields become null. Foreign account IDs must have matching roles and only one profile can use an account.

Error codes: 400 invalid input/dates/capacity; 401 signed out; 403 disallowed role/write; 404 absent/inaccessible record; 409 duplicate, wrong account role, referenced profile, or inconsistent enrollment reference. SQL values are parameterized. Parent/class/section IDs are validated as UUIDs.

## Frontend pages

Admins see Students & Parents in navigation. Create accounts in Manage users first, then profiles. Student records offer Family & enrollment for parent linking, enrollment, transfers, status changes and deleting erroneous enrollments. Parent profile editing manages phone/address. Search and Previous/Next controls page lists in groups of 25. Dropdowns load all option pages, and enrollment sections are filtered by the selected year's classes.

Parents see My family with linked children and My parent profile. Students see My profile. All are read-only; an empty list explains that the school may not have created a profile/link yet. Teachers do not see this module's navigation. Delete/unlink operations require an inline confirmation. Loading/error states and retry controls are provided.

## Automated checks

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

HTTP tests execute against the real SQL schema in PGlite (embedded PostgreSQL). Coverage includes profile CRUD, composite role FKs, family ID access checks, write restrictions, literal search, enrollment uniqueness, capacity, transfer/status changes, cross-year/class errors, date boundaries, dependency deletion, migration reruns and Auth/Academic regression tests. These checks do not establish browser or multi-connection PostgreSQL behavior; run the following acceptance checks on the real Compose stack.

## Acceptance checklist

1. Apply migrations twice. Both runs succeed; schema_migrations contains one 003_students_parents.sql row. Inspect `\d students`, `\d parents`, `\d student_parents`, `\d enrollments` in psql. Existing Auth and Academic operations still work.
2. As admin, create three student accounts and two parent accounts in Manage users. Create matching profiles. Names/emails come from the selected accounts. Duplicate account profiles and admission numbers must fail. Attempt a parent account as a student profile via API: 409.
3. Edit a profile's admission date, birth date/address or parent phone/address; reload to confirm persistence. Reject birth after admission, invalid calendar dates, future admission, script markup, invalid phone, unknown fields, malformed UUIDs and invalid pagination. API updates containing user_id are rejected.
4. Link Parent A to Students A and B; Parent B to Student B. Parents can have several children, and students several parents. Duplicate links fail. As Parent A, see only A and B; as Parent B, see only B; an unlinked parent sees an empty student list.
5. Sign in as Student A: only its own profile/enrollments and guardian names/relationships are visible. Try Student B IDs for detail, parents and enrollments via API: 404. Parent B must get 404 for Student A. Parent A cannot read Parent B's profile. Guardian lists must omit phone/email/address. Teachers receive 403 for this module.
6. Try POST/PUT/DELETE with student/parent JWTs: 403. Admin-only buttons do not appear for these roles. Changing list filters cannot bypass family scoping.
7. Create a class/section with capacity 1. Enroll Student A actively in it. Enrolling Student B actively in the same section fails. A withdrawn/completed placement does not consume a seat. Duplicate enrollment for the same student/year fails, even in another section.
8. Edit Student A's enrollment into another section; the original seat becomes available. Mark an enrollment withdrawn/completed, then reactivate it: reactivation must fail if its section is full. Reducing section capacity below active occupancy must fail. The UI uses only sections belonging to the selected year; API attempts to mismatch section/year return 409.
9. Reject enrollment before admission or outside year dates. Reject shortening a year past an enrollment or moving admission past existing enrollment. Moving an enrolled class to another year or an enrolled section to another class must fail through the Academic API.
10. Unlink a parent and immediately retry the child's profile/enrollment APIs with that parent's existing JWT: access is gone (404). Delete linked/enrolled profiles: 409. Unlink/remove erroneous enrollments first, then delete the profile; its login account remains. Cancel each delete dialog and check the record stays.
11. Create over 25 profiles to check paging/search. Parent lists should show only the caller's profile. Check optional blank fields, empty lists, loading, network errors, and reload. Restart services without deleting volumes; data persists.
12. On real PostgreSQL, issue concurrent active enrollments from separate connections for the final seat: exactly one should succeed. Repeat with capacity reduction/transfer operations, retrying any deadlock-aborted transaction. Verify the final active count never exceeds capacity.

Confirm this checklist before Module 4: Teachers starts. Attendance, fees, exams and teacher assignments remain for later modules.

## Git commands

For a local commit on top of Academic Setup:

```sh
git switch feature/academic-setup
git switch -c feature/students-parents
git add backend/database backend/src backend/tests frontend/src docs/testing/students-parents.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add student profiles, parent links and enrollment"
git push -u origin feature/students-parents
```

If the branch is already published, use `git fetch origin` and `git switch --track origin/feature/students-parents` in a clean clone. This branch includes Auth and Academic Setup; review/merge in dependency order.
