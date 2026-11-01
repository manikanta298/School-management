# Module 8: Timetable

## Scope

Admins create date-limited weekly teaching sessions for a section, using an existing subject-teacher assignment and an optional room. Each session has one weekday, start/end clock time, effective date window and active flag. Teachers see their own active teaching schedule; students and parents see schedules for their current active enrollments/linked children. Changes take effect immediately; there is no separate publication workflow.

Sessions use school-local clock times with minute precision. Monday is 1, Sunday is 7. Intervals are half-open: 09:00–10:00 and 10:00–11:00 are adjacent and do not conflict. Start is 00:00–23:59; end may be 24:00. Overnight sessions must be split. Date windows are inclusive and must contain at least one occurrence of the selected weekday. Holidays, substitutions, room capacity, travel time and automatic timetable generation are not implemented.

## Database changes

Migration `008_timetable.sql` adds:

| Table | Keys / constraints |
|---|---|
| school_rooms | UUID primary key; case-insensitive unique name; optional location; active flag; version |
| timetable_slots | UUID primary key; section/class and class/year composite FKs; teacher/subject/room/actor FKs; nullable assignment FK; weekday/time/date checks; active/version/notes/timestamps |
| timetable_audit | Identity primary key; slot/actor FKs; created/updated/deactivated/reactivated/detached action; full old/new JSON snapshots, note and timestamp |

Indexes support active section/teacher/room weekday/date conflict searches plus every reference. Existing class/year, section/class and actor records remain protected by foreign keys. Audit history is append-only. Every slot has an initial audit entry, so hard deletion is restricted; the API uses deactivation rather than deletion. No extra PostgreSQL extensions are required.

On an active slot, a trigger verifies a matching active subject assignment, active teacher employment/Auth account, effective start on/after teacher joining, and active room if one is selected. The API derives teacher, subject, class and year from the assignment. A section must match that class. Class-teacher-only assignments cannot create a teaching session.

The date window must fit the academic year. Active timetable periods prevent year-date edits that would exclude them and teacher joining-date edits that would put employment after their effective start. Class/section/subject/year moves/deletion remain constrained by referenced snapshots.

## Conflict detection

An active session conflicts if another active session reserves the same section, teacher or non-null room, on the same weekday, with overlapping clock intervals, and the common effective-date intersection contains that weekday. Shared teachers/rooms are checked across academic years, since overlapping calendars can otherwise double-book them.

A helper computes the first matching weekday within a date window; it avoids falsely rejecting ranges whose dates overlap but whose actual lesson occurrences do not. Example: Monday lessons effective 2025-10-06 through 2025-10-08 and 2025-10-07 through 2025-10-13 do not conflict: their Mondays are October 6 and 13.

Triggers acquire transaction-scoped advisory locks for the old/new teacher, section and room resource keys in a consistent order before checking conflicts. Database checks apply even outside the API. Concurrent/deadlock-aborted changes are returned as retryable 409 responses. Actual multi-connection PostgreSQL acceptance tests remain required.

## Updates, availability and teacher replacement

Slot and room updates require expected_version. Accepted updates increment the version; stale versions return 409. Slot updates/deactivations and audit entries commit atomically. Deactivating an active slot requires a reason of at least three characters; inactive sessions reserve no time. Reactivation validates current assignment, room, employment, date and conflict rules again. Slot identity and creation metadata cannot be rewritten.

Deactivating teacher employment or a room does not silently remove sessions or release their reservations. Families see unavailable-teacher/room warnings; inactive teachers cannot read their own teaching schedule. Admins must edit/deactivate affected sessions. Reactivation of the resource restores availability indicators. An inactive Auth account also makes the teacher unavailable. Other users never see contact information or internal actor IDs through timetable rows.

An active session blocks changing/removing its subject assignment. To replace a departing teacher:

1. Deactivate all active sessions using the old assignment.
2. In Teachers, remove the old assignment and create the replacement subject assignment.
3. Return to Timetable; edit/reactivate or create sessions using the new assignment and appropriate effective dates.

When the old assignment is deleted, its inactive timetable rows automatically detach (assignment_id becomes null). Teacher/subject/class/time snapshots remain; version increments and an explicit system-attributed detached audit event is recorded. This avoids blocking replacement assignment creation while keeping history. A detached slot cannot reactivate without selecting a valid current assignment. Inactive slots can retain snapshots if their old assignment later changes identity. Referenced teacher/room profiles may still be protected from deletion; use inactive status to retain history.

Audit snapshots retain IDs and values as recorded. Human-readable names are resolved from current reference records where available; the UI uses fallback labels if an old reference has since been removed. Automatic assignment detachment is labelled System rather than attributing it to an unknown administrator.

## Permissions

| Role | Active timetable | Rooms / assignment catalog | Writes / inactive history / audit |
|---|---|---|---|
| admin | All, with filters | All | Yes |
| active teacher | Own teaching sessions only | No separate catalog | No |
| student | Current active enrollment's section/year | No separate catalog | No |
| parent | Linked children's current active enrollment sections | No separate catalog | No |
| inactive/unassigned teacher or unlinked parent | No corresponding sessions | No | No |

Family access uses current active enrollments and links; transfer, withdrawal or unlink immediately changes access on subsequent requests. The module does not reconstruct historical enrollment effective dates. Teachers see their own sessions, not all colleagues' class schedules. Class-teacher responsibility alone does not add teaching sessions. Filters intersect scope and never expand access. Timetable rows include subject, teacher display name, class/section/year and room/location but no student names, contact details, guardian data or internal actor IDs.

## Upgrade

Back up the existing Modules 1–7 PostgreSQL database, then:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Use docker-compose.prod.yml in production with the existing HTTPS origin/secrets and a normal maintenance window. Without Docker, from backend run `npm ci && npm run migrate`, restart the API, then from frontend run `npm ci && npm run build` and publish the assets. No new dependencies, secrets or environment variables are needed. schema.sql contains the complete fresh-schema reference through Module 8; do not run it over an existing database.

The school date/current Monday come from PostgreSQL CURRENT_DATE, using the database timezone configured for Attendance/Fees/Exams. Weekly date arithmetic is calendar-based; clock times are local and are not converted to browser timezones. Existing assignments do not automatically generate sessions.

## API

Every endpoint requires JWT authentication and returns Cache-Control: no-store. Only admin writes or reads catalogs/history.

| Method | Path | Body / response |
|---|---|---|
| GET | /api/timetable/calendar | Any signed-in role; today, week_start (Monday) |
| GET | /api/timetable/rooms | Admin; paged `{items}` |
| POST | /api/timetable/rooms | Admin: name; optional location, active (default true); 201 |
| PUT | /api/timetable/rooms/:id | Admin: full room fields and expected_version |
| GET | /api/timetable/assignments | Admin: paged subject assignments with class/subject/teacher/joining/availability metadata; optional class_id |
| GET | /api/timetable/slots | Scoped paged `{items}` |
| POST | /api/timetable/slots | Admin: section_id, assignment_id, weekday, start_time, end_time, effective_from, effective_to; optional room_id, active, change_note; 201 |
| GET | /api/timetable/slots/:id | Scoped `{item}`; inactive rows admin-only |
| PUT | /api/timetable/slots/:id | Admin: complete slot fields plus expected_version |
| POST | /api/timetable/slots/:id/deactivate | Admin: expected_version, reason |
| GET | /api/timetable/slots/:id/audit | Admin: paged snapshots/action/note/actor/timestamp |

Lists use limit 1–100 (default 25) and nonnegative offset (default 0). Slot filters: section_id, teacher_id, room_id, academic_year_id, student_id, weekday, week_start, include_inactive. week_start must be a real Monday YYYY-MM-DD. With a week filter, rows are included only when that weekday's occurrence is inside the effective window. Non-admin requests without a week default to the current school week; admin without a week can manage all effective periods. include_inactive=true is admin-only. Teacher requests cannot use student_id. Family student filters must identify an authorized enrolled child.

Times use HH:mm, with 24:00 allowed only as end. API responses include both start_time/end_time and integer minute values for precise clients. UUIDs, real dates, ranges, weekday, versions, booleans and text are validated; unknown body/query fields are rejected. Names/notes/location reject markup/control characters. SQL values are parameterized. Room names are trimmed and unique case-insensitively; location and change notes are nullable and limited to 200 characters.

Errors: 400 invalid time/date/weekday, unavailable teacher/room or protected history; 401 signed out; 403 forbidden role/catalog/history/filter; 404 absent/inaccessible slot/assignment; 409 overlap, duplicate room name, mismatched/protected FK, stale version or concurrency retry.

## Frontend

Timetable navigation is available to all roles. Weekly view groups complete scoped results by Monday–Sunday, with previous/current/next week controls, class/section, subject, teacher, time and room. Selecting a date snaps to its Monday. Admin initially gets a section filter, teachers see My teaching timetable, and families choose an authorized student. Unavailability warnings remain visible.

Admin Manage sessions works across all effective periods, independently of the weekly view, and can include inactive history. Session forms offer only subject assignments for the selected section's class, display teacher availability and optional rooms, and default the effective start no earlier than teacher joining. Editing/reactivating a detached row requires a new assignment. Deactivation requires a confirmation/reason. Audit history shows readable before/after clock times and the underlying old/new record snapshots via the API. Rooms can be created/edited/deactivated with version checks.

Saved-session/audit lists have pagination. Weekly views fetch all scoped pages for the selected week. Loading/error/empty states and reload controls are included; error reload closes stale editors and refreshes reference options. Unavailable resources do not disappear silently. Parent/student views are read-only.

## Automated checks

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

HTTP/SQL tests use PGlite with the full schema. They cover exact section/teacher/room conflicts, overlapping years, adjacent times, null rooms, 24:00 boundaries, real weekday intersections, date/assignment/joining validation, role/family filters, stale versions, deactivation/reactivation, immutable audit, assignment detachment, availability changes, transfers/withdrawal/unlink, reference protection and pagination. Earlier module regressions and migration reruns remain in the suite.

Browser and real multi-connection PostgreSQL checks remain required.

## Acceptance checklist

1. Back up and migrate twice; one 008_timetable.sql row exists in schema_migrations. Inspect school_rooms, timetable_slots and timetable_audit keys/indexes/triggers in psql. Earlier modules still pass their acceptance checks.
2. Create rooms with unique names/location. Case-only duplicate and markup fail. Edit active/location with expected_version; stale room version fails. No hard-delete endpoint exists.
3. Create a section session from a matching active subject-teacher assignment. Reject a class-teacher-only assignment, wrong section/class, inactive employment/Auth account, inactive/missing room, effective start before teacher joining, outside-year dates, invalid weekday/date, overnight/reversed times and a date window with no matching weekday.
4. Create Monday 09:00–10:00. Overlap in the same section with a different teacher fails; the same teacher in another section fails; another class/teacher in the same room fails. Shared-teacher conflicts across overlapping academic years also fail. 10:00–11:00 succeeds. Different days/date occurrences and no assigned room behave correctly.
5. Verify narrow Monday windows Oct 6–8 and Oct 7–13, 2025: both patterns may exist at the same time/resources because they occur on different Mondays. Weekly filters show each on the correct week. Midnight end 24:00 is accepted; start 24:00 and invalid minutes fail.
6. Teacher sees only their own teaching sessions. Student sees current active section/year; linked parent sees only linked children's sections. Other slot IDs return 404. Arbitrary section/teacher/student filters cannot broaden scope. Non-admin catalogs, inactive history, audit and writes return 403. Teacher student_id filter is forbidden.
7. Edit a session: version increments and old/new snapshot is recorded. Stale edit/deactivation fails without changes. Deactivate with a reason: reservation is freed, public slot GET becomes 404, admin history remains. Reactivate at a conflicting time: reject; choose a free period: succeeds. Direct audit UPDATE/DELETE and slot hard deletion are blocked.
8. Try removing/changing an assignment used by active sessions: reject. Deactivate all its sessions, remove assignment in Teachers, and verify inactive rows detach with a system-labelled event/version increment and retained snapshots. Create replacement assignment and edit/reactivate with it. No original history is lost.
9. Deactivate teacher employment or Auth account: their own schedule access is gone; authorized families see unavailable-teacher warnings on retained sessions. Deactivate a room: sessions show unavailable-room warnings; new active bookings there fail. Reservations persist until explicitly edited/deactivated. Reactivation restores indicators.
10. Transfer/withdraw a student or unlink a parent: subsequent requests immediately follow current active enrollment/link. Reject year-date or teacher-joining edits that exclude active sessions. Referenced class/year/section/teacher/subject/room history remains protected.
11. In a browser check all Monday–Sunday cards, week/date navigation, optional room, filters, inactive history, fresh options after reload, stale-editor recovery, confirmations/cancellation, audit paging and more-than-25 session management pages. Restart without deleting volumes; schedules and audits persist.
12. On real PostgreSQL, concurrently create/move overlapping teacher/section/room sessions from separate connections: only a conflict-free state can commit. Race update/deactivation/reactivation, assignment deletion and resource availability changes; verify version conflicts, preserved audit and rollback behavior. Retry deadlock/serialization-aborted transactions. Check conflict detection sees committed rows after waiting on advisory locks.

Confirm this checklist before Module 9: Notices & Dashboards. Holiday exceptions, per-date substitutions, calendar export, automatic allocation and notifications remain outside this module.

## Git commands

To commit locally on top of Exams & Results:

```sh
git switch feature/exams-results
git switch -c feature/timetable
git add backend/database backend/src backend/tests frontend/src docs/testing/timetable.md docs/testing/teachers.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add weekly timetables and schedule conflict checks"
git push -u origin feature/timetable
```

If already published, use `git fetch origin` and `git switch --track origin/feature/timetable` in a clean clone. This branch includes previous modules; review/merge in dependency order.
