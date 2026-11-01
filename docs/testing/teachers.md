# Module 4: Teachers

## Database changes

Migration `004_teachers.sql` adds two tables and updates the existing academic-year date trigger. `backend/database/schema.sql` contains the full application schema through this module; use numbered migrations to upgrade an existing installation.

| Table | Keys, constraints and indexes |
|---|---|
| teachers | UUID primary key; one profile per teacher-role Auth account; unique uppercase employee_number; joining_date; optional phone/qualification; active/inactive employment_status; created_at/updated_at |
| teacher_assignments | UUID primary key; teacher_id FK; class_id/academic_year_id composite FK; optional subject_id FK; class_teacher/subject_teacher kind; created_at/updated_at |

The teacher account-role FK reuses the unique users(id,role) constraint from Module 3. Changing an account to another role or deleting a referenced account is restricted by PostgreSQL. Profile updates cannot change user_id. The employee number is 1–30 letters/digits/underscore/hyphen and is uppercased by the API. Joining date cannot be in the future. Phone uses the same nullable format as parent profiles; qualification is nullable and at most 200 plain-text characters.

Each class can have one class teacher. Each class/subject pair can have one subject teacher. A teacher can be both class teacher and subject teacher for a class and can teach several subjects/classes. Partial unique indexes enforce these rules, including concurrent attempts. An assignment covers all sections of its class, which already belongs to one academic year. It does not assign teachers to individual sections or timetable periods.

Class-teacher assignments require a null subject; subject-teacher assignments require a subject. The API derives the academic year from the selected class. Composite FKs prevent moving an assigned class into another year. Foreign keys restrict deleting referenced teachers, classes, years and subjects. Indexes support teacher/class, class/year, year and subject lookups, plus employment-status filtering.

Assignment triggers require an active employment profile and active Auth account, and require the teacher to have joined on or before the academic year's end. Changing a teacher's joining date or an academic year's end cannot invalidate existing assignments. Existing term and enrollment date rules remain enforced.

Deactivating employment preserves assignments but disables that teacher's roster access immediately. Reactivating restores access through retained assignments. Retained assignments still occupy their unique class/subject positions: remove the old assignment to allocate it to a replacement. Auth account status/login is separate; an inactive teacher can still log in and view their own profile and assignment list. Admins may review retained rosters for inactive teachers. Removing an assignment permanently revokes access through that assignment. Deleting a profile requires removing its assignments first and retains the Auth login account.

## Permissions

| Operation | Admin | Teacher | Student / parent |
|---|---|---|---|
| List/read teacher profiles | All | Own only | Forbidden |
| Create/edit/delete profiles | Yes | No | No |
| Read assignments | All | Own only, including retained assignments | Forbidden |
| Create/edit/remove assignments | Yes | No | No |
| Read an assignment's roster | All | Own assignment and active employment only | Forbidden |
| Read student/parent profile APIs | Existing admin permissions | Still forbidden | Existing self/family permissions |

An assignment roster returns only student_id, admission_number, name, enrollment_id, section_id and section_name for active enrollments in that exact class/year. It omits student email, birth date, address, user_id and family/contact details. Withdrawn/completed enrollments are excluded. Teacher profile phone/qualification remain private to admin and the teacher themselves. Inaccessible profile/assignment IDs return 404. Assignment ownership and active employment are rechecked in the roster SQL, not just in the UI.

## Upgrade and deployment

Back up PostgreSQL. Use the same database as Modules 1–3.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Use docker-compose.prod.yml in place of docker-compose.dev.yml for production, with the existing HTTPS origin/secrets and a normal maintenance window. Without Docker, run `npm ci && npm run migrate` from backend, restart the API, then `npm ci && npm run build` from frontend and publish the rebuilt assets. No new environment variables or dependencies are needed. Do not import schema.sql over an existing database. Applying migration 004 does not automatically create profiles or assignments for existing teacher accounts.

## API

All routes require a bearer JWT. Admin creates and changes records. Teachers read only their own records. Student/parent roles receive 403. Responses use Cache-Control: no-store.

| Method | Path | Body / response |
|---|---|---|
| GET | /api/teachers | Scoped `{items: [...]}` |
| GET | /api/teachers/:id | Scoped `{item: ...}` |
| POST | /api/teachers | user_id, employee_number, joining_date; optional phone, qualification, employment_status (default active); 201 |
| PUT | /api/teachers/:id | employee_number, joining_date, employment_status; optional phone/qualification; 200 |
| DELETE | /api/teachers/:id | 204; 409 while assignments exist |
| GET | /api/teachers/:id/assignments | Scoped `{items: [...]}` |
| POST | /api/teachers/:id/assignments | class_id, kind, subject_id (null/omitted for class_teacher, required for subject_teacher); 201 |
| PUT | /api/teachers/:id/assignments/:assignmentId | Same fields; 200 |
| DELETE | /api/teachers/:id/assignments/:assignmentId | 204 |
| GET | /api/teachers/:id/assignments/:assignmentId/roster | Scoped `{items: [...]}` with minimal student fields |

All lists support limit 1–100 (default 25) and nonnegative offset (default 0). Teacher profile lists support q (literal case-insensitive name/email/employee-number search), academic_year_id and class_id. Assignment lists support academic_year_id/class_id. Rosters support q (student name/admission number) and section_id. Filters are always combined with ownership; they never broaden access. Invalid/unknown query fields and unknown body fields are rejected.

Dates use real YYYY-MM-DD calendar dates. Null optional phone/qualification values are accepted. Omitted optional contact fields become null on full profile replacement; employment_status must be explicit on PUT so omission cannot reactivate a teacher. Phone uses 7–30 digits/+/( )/spaces/dots/hyphens. Qualification rejects markup and control characters. UUID inputs are validated. Submitted values use parameterized SQL, and table/column names are fixed in server code.

Error codes: 400 invalid input/status/dates/assignment shape; 401 signed out; 403 forbidden role/write; 404 missing/inaccessible profile, assignment or class; 409 duplicate profile/employee number, occupied class/subject assignment, wrong account role, missing FK reference or dependent record.

## Frontend

Admins see Teachers in navigation. Create a teacher-role Auth account in Manage users, then create its teacher profile. Profile cards open Assignments & rosters; admins can create/edit/remove assignments or review active class rosters. Academic year is shown alongside each class in selectors. Selecting subject_teacher reveals the required subject selector.

Teachers see My teaching, their own profile, their assignment list, and View roster for active assignments. They have no write controls or access to Students & Parents. Inactive profiles explain why roster access is disabled. Profile deletion and assignment removal have explicit inline confirmations. Profile and roster lists have paging; search, section filters, loading/error/empty states and retries are included. Names, emails, employee numbers and optional fields render as escaped text.

## Automated checks

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

Teacher integration tests execute the full SQL schema and HTTP handlers using PGlite. They cover profile CRUD/validation, own-profile scope, write restrictions, assignment uniqueness/shape, minimal roster responses, cross-teacher ID attempts, roster search/section filters/pagination, deactivation/reactivation, reassignment/removal, protected academic records, and account-role FKs. Existing Auth, Academic, Students & Parents and migration-rerun tests remain part of the suite.

These checks do not replace actual browser, Docker or multi-connection PostgreSQL testing.

## Acceptance checklist

1. Back up and migrate the existing database twice. Both runs succeed; schema_migrations has one 004_teachers.sql entry. Inspect `\d teachers` and `\d teacher_assignments` in psql. Existing Auth accounts, family links, enrollments and Academic operations still work.
2. As admin, create two teacher-role accounts and profiles with unique employee numbers, joining dates and optional phone/qualification. Names/emails come from Auth. Duplicate account or case-equivalent employee numbers fail. Attempt a student account for a teacher profile through the API: 409. Unknown fields, invalid phone/date, future joining date and markup fail.
3. Edit a teacher's employee number/contact/qualification/status. Reload to confirm persistence. PUT with user_id fails; omitting employment_status also fails. Names/email/password remain managed in Auth.
4. Assign Teacher A as class teacher for Class 1 and mathematics subject teacher for Class 2. Assign Teacher B as science subject teacher for Class 1. A class teacher and subject teacher may coexist. A second class teacher for Class 1 or a second mathematics teacher for Class 2 fails with 409. Subject-teacher without a subject and class-teacher with a subject fail with 400.
5. Sign in separately as each teacher. Each sees only their own profile and assignments. Teacher A cannot read Teacher B's profile/assignment/roster IDs (404). Student/parent accounts cannot read this module (403). Teachers cannot POST/PUT/DELETE any profile/assignment (403).
6. Enroll active students in two sections of Class 1 and one in Class 2; include withdrawn/completed students. A Class 1 assignment returns only its active enrollments, across both sections. Teacher A's Class 2 subject assignment returns only Class 2. Rosters must omit email, DOB, address, user_id, phone and guardian information. Teacher /api/students and /api/parents access remains 403.
7. Test roster q search and section filter. A section in another class returns an empty list. Invalid UUID/pagination/unknown query fields return 400. Over 25 active students page correctly. SQL-looking q text is treated literally and does not broaden results.
8. Set Teacher A's employment inactive while signed in elsewhere. The existing JWT still allows their own profile/assignment list, but roster requests immediately return 404. New/edited assignments for inactive employment fail. Admin can review retained assignments and rosters. Reactivation restores access. An inactive Auth account cannot authenticate at all.
9. Remove one assignment and immediately retry its roster URL with the same teacher JWT: 404. Their other valid assignment continues to work. Edit an assignment into another class/subject and verify the roster follows the new class/year. Remove and recreate an assignment to transfer its class/subject to a replacement teacher.
10. Reject a joining-date change after an assigned year's end. Reject reducing a year end before its assigned teacher joined. Moving an assigned class to another year or deleting referenced subjects/classes/years must fail. Existing term/enrollment constraints must also continue to hold.
11. Teacher profile deletion with assignments returns 409. Cancel removal dialogs and confirm data stays. Remove assignments first, then delete the profile: its Auth account remains and its teacher list becomes empty. Reload and restart services without deleting volumes; remaining records persist.
12. On real PostgreSQL, create duplicate class-teacher or class/subject assignments concurrently from separate connections: exactly one must succeed. Confirm FK checks and unique indexes remain effective during simultaneous updates, retrying any deadlock-aborted transaction.

Confirm these checks before Module 5: Attendance. Timetable scheduling, attendance marking and grading are not part of Teachers.

## Git commands

To create this module's commit locally on top of Students & Parents:

```sh
git switch feature/students-parents
git switch -c feature/teachers
git add backend/database backend/src backend/tests frontend/src docs/testing/teachers.md docs/testing/students-parents.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add teacher profiles, assignments and scoped rosters"
git push -u origin feature/teachers
```

If already published, use `git fetch origin` and `git switch --track origin/feature/teachers` in a clean clone. This branch includes the previous modules; review and merge in dependency order.
