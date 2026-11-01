# Module 5: Attendance

## Database changes

Migration `005_attendance.sql` adds daily section registers, student marks and correction history. `backend/database/schema.sql` is the full application schema through Module 5; use migrations for upgrades.

| Table | Keys and constraints |
|---|---|
| attendance_registers | UUID primary key; unique section/date; version counter; immutable section/class/year/date identity; creator FK; composite section/class and class/year FKs |
| attendance_entries | UUID primary key; unique register/student; enrollment/student/marker FKs; register/date composite FK; status present/absent/late/excused/void; optional note and correction reason |
| attendance_audit | Identity primary key; entry/actor FKs; previous/new status and note, reason, timestamp; update/delete trigger rejects rewriting history |

A partial unique index permits only one non-void mark per student/date across all sections. New marks require an active enrollment in the section/year, enrolled on or before the attendance date. Register dates must be within the academic year and cannot be in the future. Corrections cannot change the identity of a saved entry and must include a reason of at least three characters when status/note changes. Triggers append audit rows for initial marks and corrections. New marks cannot start as void.

Indexes cover section/date, class/year, year/date, student/date, enrollment, register/student and audit entry/actor references. All referenced accounts/records use restricted deletion. Attendance prevents deleting referenced enrollments or moving their enrollment date after a saved mark; it also prevents changing their student/year identity. Existing same-year section/class transfers and withdrawal/completion remain supported. Existing marks retain their original register's class/section/year. Academic year dates cannot be changed to exclude a saved register.

There is no deletion API for saved attendance. Correct a wrong status/note with a reason. Use void for an erroneous mark; it remains visible in history/audit and is excluded from attendance rates. Voiding a mark frees that student's day so it can be recorded in another section after a transfer. Restoring the old mark conflicts if another section already has a non-void mark that day.

## Permissions

| Role | Daily registers and section summaries | Mark/correct | Personal history | Audit history |
|---|---|---|---|---|
| admin | All sections | All sections | All students | Yes |
| active class teacher | Assigned class, all its sections | Assigned class; no dates before joining | No separate student-history API | No |
| active subject teacher | Assigned class, all its sections | No | No separate student-history API | No |
| student | No | No | Own only | No |
| parent | No | No | Linked children only | No |
| inactive/unassigned teacher | No | No | No | No |

Current assignments control access to historical registers too. A class teacher can also have a subject assignment; removing only the class-teacher assignment leaves read access through the subject assignment but removes marking access. Employment deactivation or removal of the last assignment immediately removes class access. Unlinking a parent immediately removes that child's history access. Student/parent profile APIs remain protected as in earlier modules.

Authorized staff register rows contain student ID, enrollment ID, name, admission number and the attendance status/note. They do not include student email, DOB, address or guardian information. Personal histories show class/section/year, date, status and note; current notes are visible to the student and linked parents. Audit reasons/previous notes/actor names are admin-only. Do not put unrelated confidential information in attendance notes.

## Save and reporting behavior

GET never creates a register. The UI marks only edited rows; it does not default everyone present or absent. An explicit button can set unmarked rows on the current page to present. The register is paged in groups of 25. Save supports 1–100 distinct student rows per batch, with a 128KB JSON limit for Attendance (other APIs retain 16KB). Notes and correction reasons are limited to 200 plain-text characters. Duplicate student IDs/unknown body fields are rejected.

Every save is one PostgreSQL transaction: all entries, audit records and the register version commit together, or all roll back. A transaction-scoped advisory lock serializes saves for the same section/day, and row locks protect the version, employment/assignment and enrollment checks. The client sends expected_version from GET (0 before the first save). A stale version returns 409 and requires reloading before retrying. A no-op save creates no audit rows and does not increment the version. Adding new marks to an existing register does not need a correction reason; changing saved marks does. Corrections of several entries may share the supplied reason.

Daily eligibility is based on **current active enrollments**, plus saved records for the requested section/date. The enrollment module does not maintain transfer/withdrawal effective-date history, so the app does not invent historical rosters. A withdrawn or transferred student retains existing attendance in its original register and those marks can be corrected; an unmarked withdrawn student is not eligible for a new mark. Students with a non-void mark elsewhere that day are excluded from another section's unmarked roster.

Reports count saved marks only. Unmarked days, holidays and weekends are not automatically classified as absences. Recorded days include present/late/absent/excused, excluding void. Attendance percentage is `(present + late) / (present + late + absent) × 100`; excused and void are excluded from the denominator. If the denominator is zero, the rate is null (shown as —). Section summaries include students with saved marks in that section/range, not an assumed school calendar. Personal summaries span all sections in the selected date range, with void rows retained in history. Reports accept up to 366 inclusive days.

## Upgrade and school date

Back up PostgreSQL. Use the existing database from Modules 1–4:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Use docker-compose.prod.yml instead of docker-compose.dev.yml for production and your normal maintenance window. Without Docker: run `npm ci && npm run migrate` from backend, restart the API, then run `npm ci && npm run build` from frontend and publish the assets. No new secrets/dependencies are required. Do not import schema.sql over an existing database.

Attendance's school date and future-date checks use PostgreSQL CURRENT_DATE. The Compose image defaults to UTC. Configure the database timezone for the school's calendar before live use, for example:

```sql
ALTER DATABASE school SET timezone TO 'Asia/Kolkata';
```

Use the school's actual IANA timezone, then restart the backend so new pool connections inherit the database setting. The frontend gets the school date from the API instead of guessing from the browser's timezone. Existing SQL DATE values are calendar dates and do not shift when this setting changes; stored audit timestamps remain absolute timestamps. Verify the school date displayed in Attendance after configuration. The test suite uses the embedded database's default UTC setting.

## API

All endpoints require JWT authentication and return Cache-Control: no-store.

| Method | Path | Access / response |
|---|---|---|
| GET | /api/attendance/calendar | Any signed-in role; `{today}` |
| GET | /api/attendance/sections | Admin/teacher; scoped `{items, today}` with can_mark |
| GET | /api/attendance/register | Admin/assigned active teacher; `{register: {id,version,attendance_date} or null, items}` |
| PUT | /api/attendance/register | Admin/assigned active class teacher; `{version, changed}` |
| GET | /api/attendance/summary | Admin/assigned active teacher; `{items}` per-student section totals |
| GET | /api/attendance/students/:id | Admin/self/linked parent; `{items, summary}` |
| GET | /api/attendance/audit | Admin only; `{items}` newest change first |

Queries:

- Sections: limit 1–100 (default 25), offset >=0 (default 0), optional academic_year_id.
- Register/audit: section_id, date (YYYY-MM-DD), plus limit/offset.
- Section summary: section_id, from, to.
- Personal history: from, to, plus limit/offset.

PUT body:

```json
{
  "section_id": "<section UUID>",
  "date": "2025-09-01",
  "expected_version": 0,
  "entries": [
    {"student_id": "<student UUID>", "status": "present", "note": null}
  ],
  "correction_reason": null
}
```

For corrections, use the latest version and provide a reason. The server derives enrollment/actor/register identity; clients cannot submit those fields. Values are parameterized; IDs, real calendar dates, ranges, limits, statuses and notes are validated. Marking checks active Auth role, employment, class-teacher assignment and joining date inside the save transaction. Individual inaccessible sections/students return 404. 400 means invalid input/eligibility/dates/reason; 401 signed out; 403 forbidden role; 409 stale version, another section's non-void mark, protected reference, or a concurrency retry condition. Large JSON requests return 413.

## Frontend

Attendance navigation is available to all roles. Staff choose a class/section/year and date, then mark the daily register or read section summaries. Subject teachers get read-only registers. Changes on a register page must be saved or discarded before changing its section/date/view/page. A stale-version error offers an explicit reload-and-discard action. Admins can open audit history for the selected section/day. Students/parents get Student history with only authorized student options; admin also has this view. History and audit pages have paging. Range filters, empty/loading/error states and retries are included.

## Automated verification

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

Integration tests execute HTTP handlers and the complete SQL schema against PGlite. Attendance checks cover permissions, atomic failed batches, first-save/no-op/stale versions, reasons/audit immutability, history and rate calculations, family scoping, transfer/void behavior, protected enrollments/years, revoked teacher access, enrollment/joining dates, pagination and bounded JSON payloads. Earlier module tests and migration reruns remain part of the suite.

Embedded tests do not replace browser or real multi-connection PostgreSQL testing.

## Acceptance checklist

1. Back up and migrate twice. One 005_attendance.sql row exists in schema_migrations. Inspect `\d attendance_registers`, `\d attendance_entries`, `\d attendance_audit` in psql. Existing Auth, Academic, Students & Parents and Teachers checks still pass.
2. Configure and verify the school date/timezone. Daily date selection rejects future dates and dates outside the section's academic year. Choose a past year/date when checking historical records.
3. Create a class teacher, subject teacher and unrelated teacher; enroll students in two sections of one class and a section in another. Class/subject teachers see only assigned sections. Class teacher can mark; subject teacher is read-only and PUT returns 404. Unrelated/inactive teachers cannot read or mark the section. Students/parents cannot use staff endpoints (403).
4. GET an unmarked register: register is null; no database header is created. All eligible rows start Not marked. Select statuses/notes on a page and save. Reload to confirm persisted marks. Set unmarked rows present affects only this page and requires Save. Unmarked days never become absences.
5. Attempt a batch with one eligible student and one from another section: 400 and no partial marks/audit/version changes. Duplicate student IDs, extra fields, markup, invalid dates/statuses and over-100-row batches fail. Normal bounded 100-row Unicode-note JSON passes parsing; oversized wire bodies return 413.
6. Open the same register in two sessions. Save in one; saving the stale version in the other returns 409 without changing anything. Reload/discard explicitly, reapply desired edits and save. No-op saves keep the same version and add no audit rows.
7. Correct a saved status/note: a reason of at least three characters is required. Check admin audit history shows initial and old/new status/note, reason, actor and timestamp. Teachers/parents/students cannot read the audit endpoint. Database UPDATE/DELETE of audit rows is rejected.
8. Transfer a marked student to another section within the same year. Original saved marks remain. The new section excludes that student's already-marked day. To correct a wrong section, void the original mark with a reason, then mark in the new section. Restoring the old non-void mark now fails with 409. Voids remain in history but not the rate.
9. Withdraw/complete a student: existing marks remain readable/correctable, but missing new marks cannot be created from an inactive enrollment. Reject attendance before enrollment or a teacher's joining date. Reject deleting an attended enrollment, changing its student/year, moving enrollment date after a saved mark, or shortening the year past a register.
10. Mark present, late, absent, excused and void examples. Check section/personal totals: rate uses present+late over present+late+absent; excused/void are excluded. A range with only excused/void has no percentage; no saved marks gives zero counts and no rate. Ranges over 366 inclusive days and reversed ranges fail.
11. Student sees own history only; linked parent sees the child only. Changing student IDs returns 404; unlinking the parent immediately revokes access using the same JWT. Teachers cannot use personal student-history endpoints or read private student/parent profiles.
12. Remove the class-teacher assignment or deactivate employment while the teacher is signed in. Marking/access changes immediately. If another subject assignment remains, read-only access remains. Admin still marks/reviews records. Reactivation restores retained assignment access.
13. Create more than 25 eligible students/marks and audit changes to verify all paging. Save/discard behavior, blank notes, retries, range changes and empty states work in a browser. Restart without deleting volumes and confirm persistence.
14. On real PostgreSQL, save the same section/date/version from separate connections: exactly one commits and the other receives 409. Race saves across sections for one student's date: the unique index permits only one non-void mark. Race a save with assignment removal, employment deactivation, transfer and year-date edits; confirm authorization/constraints and rollback behavior, retrying deadlock-aborted transactions.

Confirm these checks before Module 6: Fees. No holiday calendar, attendance notifications, per-period attendance or automated absence generation is implemented.

## Git commands

To commit locally on top of Teachers:

```sh
git switch feature/teachers
git switch -c feature/attendance
git add backend/database backend/src backend/tests frontend/src docs/testing/attendance.md docs/testing/students-parents.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add daily attendance, corrections and scoped reports"
git push -u origin feature/attendance
```

If already published, use `git fetch origin` and `git switch --track origin/feature/attendance` in a clean clone. This branch includes the previous modules; review and merge in dependency order.
