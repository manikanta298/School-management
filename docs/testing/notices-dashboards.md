# Module 9: Notices & Dashboards

## Scope

Admins create plain-text announcements targeted to a role, optionally a class/section, with priority and availability/expiry times. Notices move through draft, published and archived states. Recipients explicitly acknowledge the current content version. Dashboards summarize the existing modules according to the signed-in account's permissions.

Notices are in-app only: this module does not send email, SMS, push notifications or messages through an external service. Scheduling is evaluated when users request notices; no background delivery job is required. Rich HTML, attachments, per-person mailing lists and mobile push delivery are not implemented.

This is the ninth/final module in the approved list. The full application still requires browser and real PostgreSQL/deployment acceptance testing before live use.

## Database changes

Migration `009_notices.sql` adds:

| Table | Keys / constraints |
|---|---|
| notices | UUID primary key; title/body; audience/priority/state checks; class/year MATCH FULL FK; section/class FK; creator/updater FKs; availability/expiry; version and content_revision; timestamps/reason |
| notice_reads | Notice/user/content-revision composite primary key; notice/user FKs; acknowledgment timestamp |
| notice_audit | Identity primary key; notice/actor FKs; lifecycle action, old/new JSON snapshots, reason and timestamp |

Indexes support visibility windows, class/year, section/class, actors, per-user read state and notice audit paging. References restrict deletion of audience targets/accounts/history. Every notice has an audit entry; hard deletion is restricted and there is no delete endpoint. Audit and acknowledgment rows are append-only.

A notice starts at draft/version 1/content revision 1. Every accepted save or lifecycle action increments version. Content revision increments only when title, body, audience, scope, priority or visibility times change; pure lifecycle transitions and identical draft saves preserve it. Published/archived content cannot be edited until it is draft again. Database triggers enforce identity/version/revision/state rules and append audit snapshots atomically.

Draft creation may default to all roles, whole school and normal priority. PUT is a full replacement and requires explicit audience, class_id, section_id, priority and expires_at (nullable where appropriate), so omitting targeting fields cannot silently broaden recipients. Dates use ISO timestamps with an explicit Z/offset and at most millisecond precision; input is normalized to UTC. Expiry must be strictly after availability. Publishing an already expired window is rejected.

## Visibility and audience

A normal recipient sees a notice only when all are true:

- State is published.
- available_from is on/before the request's database timestamp.
- expires_at is null or strictly after that timestamp.
- Audience is all or matches the signed-in role.
- If class/section-scoped, the recipient has the relevant current active enrollment, family link or teaching assignment.

| Role | Global audience | Class/section scope |
|---|---|---|
| admin | Reviews every live published audience | Bypasses class/role filters as manager; can separately preview/manage every state/window |
| teacher | all/teacher | Active employment and any current assignment to that class/year; class-wide assignments cover all its sections |
| student | all/student | Own active enrollment in that class/year and selected section if specified |
| parent | all/parent | Linked child's active enrollment in that class/year and selected section if specified |

Global notices do not require a student/teacher profile. Inactive/missing teaching profiles lose class notices but may still see global teacher notices if their Auth account is active. Transfers, withdrawal, family unlink and assignment/employment changes affect access on subsequent requests. Class targeting uses current active enrollment status rather than reconstructing historical transfer dates.

Admin feed includes all live notices for operational review, even announcements targeted to another role. Manage view includes drafts, scheduled, expired and archived items. Ordinary recipients cannot preview these by changing IDs or filters; inaccessible items return 404. Public feed items include a short body preview, scope metadata, author display name and the caller's read flag, not other readers' identities/counts or internal actor IDs.

Availability is request-based. A page already loaded is not a live revocation channel; refresh/navigation rechecks current access and timestamps. Browser local-time controls are converted to absolute timestamps; recipients see equivalent local display times. Database time determines the visibility boundary, including exact expiry (end exclusive).

## Lifecycle and read tracking

| Action | Transition / requirements |
|---|---|
| Save draft | Create or update a draft; full validated body; expected_version on update |
| Publish / schedule | draft → published; expected_version; a future available_from schedules visibility automatically |
| Unpublish | published → draft; version and 3–200-character reason; immediately hides recipients' access |
| Archive | draft/published → archived; version and reason; preserves history |
| Restore | archived → draft; version and reason; review/edit then publish again |

Viewing a notice does not acknowledge it. POST /read sends the content_revision actually displayed. The transaction locks the notice, rechecks live audience access and inserts one acknowledgment for that user/version. An exact retry is idempotent and preserves the original timestamp. A stale content version returns 409. Clients cannot submit another user ID.

Semantic edits increment the content version and make it unread again after publication, while retaining previous acknowledgments. Republishing unchanged content preserves its read state. Admin can page through readers for the current or a specified historical content revision and review complete audit snapshots. This tracks explicit acknowledgments, not email delivery, time spent reading or proof of comprehension. Reader identity/history is admin-only, including when the reader later leaves the audience.

## Role dashboards

GET /api/dashboard derives scope from authenticated identity; it accepts no user_id/role override. It rechecks active Auth role and runs all queries in one repeatable-read, read-only transaction. Existing fee and timetable models accept that same client, keeping notices, counts, balances and schedules in one coherent snapshot.

| Role | Dashboard summaries |
|---|---|
| admin | Active account counts by role; student/parent profiles; available active teachers; current-year classes/sections/active enrollments/exam counts; current-year attendance recorded today; draft/scheduled notice counts; fee balances across all years by currency |
| teacher | Own profile state; active assignment/class/subject counts across assigned years; assigned-class exam counts; recorded attendance in assigned classes today; own teaching sessions; visible notices |
| student/parent | Authorized profile count and first five minimal profile cards; active enrollments; distinct published registered exams; own/linked-student attendance today; authorized invoice balances across all years; current active-section sessions; visible notices |

Every role receives unread notice count, first five visible notice previews, school date/timezone, selected current academic year if one exists, and first five authorized sessions occurring today. Sessions are the first five by time, not a promise that they are still upcoming. Full timetable/notice/profile views are linked.

Administrative current-year counts are zero if no academic year is selected; the UI explains how to set one. Financial balances remain across all billing years rather than hiding previous debts. Teachers receive no finance payload or global user/profile counts. Families receive no school-wide account/enrollment/exam/financial aggregates. Profile cards omit DOB, address and contact information. An inactive/missing teacher profile has zero teaching-scoped summaries and an explanatory state; global teacher notices may remain visible.

Attendance cards count saved present/late/absent/excused entries only; void entries and unmarked students are not absences. Fee totals reuse existing exact minor-unit, currency-separated, reversal/void-aware logic; overdue remains a subset of outstanding. Published-exam counts reveal no draft marks and respect registered candidates. No dashboard operation changes source data or creates a read receipt.

## Upgrade

Back up the existing Modules 1–8 PostgreSQL database, then:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Use docker-compose.prod.yml in production with the existing HTTPS origin/secrets and normal maintenance window. Without Docker, run `npm ci && npm run migrate` from backend, restart the API, then run `npm ci && npm run build` from frontend and publish the rebuilt assets. No new dependencies, secrets or environment variables are needed. schema.sql is the complete fresh-schema reference through Module 9; never import it over an existing database.

School dates use the PostgreSQL timezone configured for earlier modules. Notice scheduling uses absolute timestamptz values and /api/notices/calendar returns server now. No notices are seeded or sent to actual users by this migration.

## API

All routes require JWT authentication and return Cache-Control: no-store. Paginated notice/read/audit lists accept limit 1–100 (default 25) and offset >=0 (default 0).

| Method | Path | Access / body / response |
|---|---|---|
| GET | /api/notices/calendar | Any signed-in role; `{now}` |
| GET | /api/notices | Scoped live `{items}`; q, unread_only true/false, priority |
| GET | /api/notices/manage | Admin all-state `{items}`; q, status, class_id, priority |
| POST | /api/notices | Admin; creates draft; 201 `{item}` |
| GET | /api/notices/:id | Scoped full content; admin preview permits any state/window |
| PUT | /api/notices/:id | Admin draft replacement; expected_version; `{item}` |
| POST | /api/notices/:id/publish | Admin: expected_version |
| POST | /api/notices/:id/unpublish | Admin: expected_version, reason |
| POST | /api/notices/:id/archive | Admin: expected_version, reason |
| POST | /api/notices/:id/restore | Admin: expected_version, reason |
| POST | /api/notices/:id/read | Caller: content_revision; 204 |
| GET | /api/notices/:id/readers | Admin; optional content_revision (defaults current); `{content_revision,items}` |
| GET | /api/notices/:id/audit | Admin; `{items}` with complete prior/new snapshots |
| GET | /api/dashboard | Role-specific coherent summary; no query parameters accepted |

Create/update fields: title (1–150), body (1–5000 plain-text characters, multiline allowed), audience (all/admin/teacher/student/parent), class_id and section_id (nullable), priority (normal/important/urgent), available_from (offset-aware ISO timestamp), expires_at (nullable timestamp). section_id requires a matching class. The server derives academic_year_id, creator/updater and read user identity. Unknown fields and invalid IDs/ranges/roles/statuses/text are rejected. HTML/markup/control characters are rejected and React renders content as escaped text; ordinary SQL-looking text remains parameterized literal data. Search uses literal case-insensitive matching, not interpolated SQL.

Responses include version, content_revision, is_read and visibility (draft, archived, scheduled, expired, live). Admin additionally sees current-version reader_count. Errors: 400 validation/date/revision/state errors; 401 signed out; 403 disallowed role/query override; 404 missing/inaccessible/non-live notice; 409 stale version/content, wrong lifecycle transition, mismatched/protected references or concurrency retry.

## Frontend

Notices navigation is available to all roles. Feed has literal search, priority/unread filters, scope labels and explicit Read notice / Mark as read actions. Admin Manage all notices can preview every state/window; Create draft configures role/class/section, priority and local-time window. Draft edit requires unpublishing first. Lifecycle actions have confirmations and required reasons where applicable. Reader tables and audits are admin-only and paged; old/new bodies remain plain text.

The login landing page is now the live role dashboard instead of a static account card. It shows relevant counters, attendance, currency balance cards, authorized profile cards, today's first five sessions, latest notices and module quick links. Dashboard notice links open that exact notice. Manage users quick link loads the user list before navigation. Refresh/retry controls, missing-current-year/profile explanations, unavailable-resource indicators and empty states are included. Read acknowledgment updates the feed; returning to Dashboard fetches fresh unread state.

## Automated verification

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

HTTP/SQL tests use PGlite and the complete schema. New coverage checks role/class/section targeting, scheduled and expired-publication rules, literal search, explicit/idempotent/revision acknowledgments, stale lifecycle/content updates, required recipient fields on draft replacement, unread resets, archive/restore, immutable history, dashboard scoped attendance/finance/exam/profile counts, missing current year/profile, transfers/unlink/inactive teaching, pagination and query validation. Earlier module regressions and migration reruns remain included.

Embedded tests do not replace browser or real multi-connection PostgreSQL/deployment checks.

## Acceptance checklist

1. Back up and migrate twice; exactly one 009_notices.sql record exists in schema_migrations. Inspect notices, notice_reads and notice_audit keys/indexes/triggers. No example notice is automatically created. Earlier modules remain functional.
2. As admin create a global draft, role-specific drafts, class-wide and section-specific drafts. Reject blank/oversized/markup content, invalid dates/offsets, expiry before availability, wrong class/section and unknown fields. Non-admin creates/edits/state actions are forbidden. PUT must include explicit recipient and expiry fields rather than silently defaulting to broader scope.
3. Drafts are hidden from ordinary recipients; admin preview works. Publish a live notice: matching recipients see it. Wrong roles/classes/sections do not. Assigned active teachers can read notices for any section in their class; global notices do not require a profile. Filters/search/IDs cannot broaden access.
4. Publish a notice starting a few minutes ahead with expiry afterward. Before start, recipients get no feed/detail/read access; after start it appears; at/after expiry it disappears. Admin still previews scheduled/expired content. Publishing an already expired draft fails. Verify browser timezone conversion and server-time boundaries with two browser timezones.
5. GET/view does not mark read. Explicit acknowledgment creates one current-version receipt; retry is idempotent. Other user IDs cannot be supplied. Non-admin reader/audit endpoints fail. Admin current/historical reader lists show only names/roles/time, not arbitrary peer email data.
6. Use two admin sessions: stale draft save/state action returns 409. Unpublish, edit content/audience/schedule, then publish: recipients must acknowledge the new content version; old receipts remain. A stale acknowledgment returns 409. Unpublish/republish unchanged content preserves prior acknowledgment. Audit shows all states and old/new values.
7. Archive with a reason: recipients lose access immediately on the next request. Restore to draft with a reason, review/edit and publish again. Hard-delete notice/history/read rows is restricted; raw audit/receipt rewriting is blocked. There is no external email/SMS/push side effect.
8. Compare dashboards for admin, two teachers in different classes, students, linked and unlinked parents. Counts, notice previews, sessions and balances remain strictly scoped. Teachers see no finance/global-user payload. Families see no other student/profile/financial/exam aggregates, DOB, email or address. Dashboard role/user query overrides fail.
9. Seed source modules with different classes' attendance, invoices in multiple currencies, published/draft exams and current-week sessions. Check dashboard counts against those source records. Unmarked attendance is never absent; finance includes all years by currency and excludes void/reversed amounts correctly. Only published registered exams count for families.
10. Remove current-year selection: admin current-year counters/attendance become zero with an explanation; profile totals and all-year balances remain. Missing/inactive teacher profile shows no teaching-scoped data. No student profile/link produces an appropriate empty family view.
11. Transfer/withdraw a student, unlink a parent, remove a teacher assignment or deactivate employment/Auth account while sessions are open. Refresh/API access must immediately follow current scope. Dashboard data is recomputed, not persisted as a stale per-role cache. Global notices may remain available according to role.
12. In a browser test notice/read/audit paging beyond 25, priority/unread/search filters, long multiline plain-text bodies, lifecycle confirmation cancellation, local timestamp controls, exact notice links from Dashboard, all quick links, retry/empty states and refreshed unread counts. Restart without removing volumes; notices, receipts and audits persist.
13. On real PostgreSQL race draft edits, state changes and read acknowledgments. Confirm stale versions/content are rejected, receipts are unique and audit entries are atomic. Race dashboard reads with unpublish/expiry/unlink, fee payments and exam reopen: each response must reflect one consistent authorized snapshot. Retry deadlock/serialization-aborted transactions.
14. Run all prior acceptance guides and the Docker production build, apply every migration to a restored database backup, and perform the complete role flow over HTTPS before live deployment. A published code branch is not a deployment or a merge into main.

All nine approved modules are now implemented. Confirm this final checklist before integration/merge/deployment work.

## Git commands

To commit locally on top of Timetable:

```sh
git switch feature/timetable
git switch -c feature/notices-dashboards
git add backend/database backend/src backend/tests frontend/src docs/testing/notices-dashboards.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add targeted notices and role-scoped dashboards"
git push -u origin feature/notices-dashboards
```

If already published, use `git fetch origin` and `git switch --track origin/feature/notices-dashboards` in a clean clone. This branch contains all previous modules; review/merge in dependency order.
