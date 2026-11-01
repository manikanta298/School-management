# Module 7: Exams & Results

## Scope

Admins create class/year exams, optionally within a term, choose a grading scale, register candidates and configure one paper per subject (up to 30 per exam). Active subject teachers enter whole-number scores for their assigned subjects. Class teachers preview full class results. Only admins publish, reopen or cancel exams. Students and parents see authorized published results only.

Papers support scored, absent and exempt outcomes. Scored requires an integer from 0 to the paper's maximum; absent/exempt require null score, and exemption requires a remark of at least three characters. Missing marks are pending, never inferred as zero. This module provides browser report cards; rankings, per-question scoring, decimal marks, printable/PDF certificates and notifications are not implemented.

## Database changes

Migration `007_exams.sql` adds:

| Table | Purpose / constraints |
|---|---|
| exam_grading_scales | UUID primary key; case-insensitive unique name |
| exam_grade_bands | Scale/minimum-percent composite primary key; unique label per scale; integer threshold 0–100; label 1–5 uppercase letters/digits/+/- |
| exams | UUID primary key; class/year and optional term/year composite FKs; grading-scale/actor FKs; immutable setup; draft/published/cancelled state; active class-scoped unique name |
| exam_candidates | Exam/student composite primary key; enrollment/student FKs; exam/class and section/class composite FKs; fixed candidate identity |
| exam_papers | UUID primary key; exam/subject FKs; unique subject per exam; date, max/pass marks and version |
| exam_marks | UUID primary key; paper/student unique key; paper/exam and exam/student composite FKs; typed outcome/score/remark; marker FK |
| exam_mark_audit | Identity primary key; mark/actor FKs; previous/new values, correction reason and timestamp |
| exam_events | Identity primary key; exam/actor FKs; created/published/reopened/cancelled action, reason and timestamp |

Every reference has supporting indexes. Foreign keys restrict deletion of referenced accounts, students, enrollments, sections, classes, subjects, terms and scales. Update/delete of mark audit and exam events is blocked. Mark identity cannot change, and deleting a marked candidate/paper is restricted by retained references. There is no mark deletion API.

Exam dates must fit the selected academic year and optional term; the term must belong to that year. Paper dates must fit the exam. Maximum marks are 1–1000; pass marks are 0–maximum. New/changed marks require a draft exam and a paper held on or before the database school date. Marked paper setup is immutable. Unmarked paper edits increment its version so a previously loaded mark sheet cannot silently use obsolete maximum/pass/date settings.

An enrollment referenced by a candidate cannot be deleted, moved to another student/year or have enrolled_on moved after exam start. Same-year class/section transfers and withdrawal remain supported; the candidate's original section and marks are retained. Academic-year/term dates cannot be shortened to exclude exams. Assigned classes/subjects and grading scales are protected by FKs.

## Candidate and exam lifecycle

Exam creation snapshots current active class/year enrollments with enrolled_on on/before exam start. New students are not silently added afterward. Admin can add eligible candidates while draft, or remove candidates with no saved marks. Teachers mark registered candidates, including ones who later transfer/withdraw; admins must review the registration before publication. Enrollment effective-date/transfer history is not reconstructed.

Exam name/class/year/term/dates/grading-scale setup is fixed after creation. Cancel and replace an incorrect exam. A cancelled exam is terminal, retains its records and is hidden from families; its name can be reused for a replacement. Papers can be edited/deleted only while draft, and their setup cannot change once marks exist.

Publication requires at least one candidate, at least one paper, every candidate/paper pair explicitly marked, and exam end on/before today. Published exams reject mark/setup/candidate writes. Admin reopens with a reason to hide family results and allow audited corrections, then publishes again after completeness checks. Cancelling a draft also requires a reason. Published exams must be reopened before cancellation.

Publication locks the exam exclusively; mark saves hold a shared exam lock and an exclusive paper lock. Candidate/setup changes also lock the exam. Result reports use one repeatable-read, read-only database transaction, so metadata, visibility, marks and grades come from the same snapshot: a concurrent reopen cannot mix old publication state with new draft scores.

## Grading

A default immutable-when-used scale is seeded: A ≥90%, B ≥80%, C ≥70%, D ≥60%, E ≥50%, F ≥0%. Admin may create another named scale with 2–10 unique threshold/label pairs and a mandatory zero threshold. The highest threshold met determines the grade; upper bounds are implied by the next threshold. Once referenced by any exam, bands cannot be changed; create a new scale for future exams.

Grades use integer comparisons of exact score/maximum fractions, before display rounding. Pass/fail is separate and uses each paper's configured pass marks. An absent paper counts zero, includes its maximum and fails that paper. Exempt papers are excluded from score/maximum and have no grade/pass flag. All-exempt results are exempt, with no percentage/grade. Any missing outcome makes a preview incomplete, with no overall percentage/grade. Publication prevents families from receiving incomplete results.

Overall percentage is weighted: sum of scored marks (absent counts zero) divided by summed non-exempt maxima. Overall pass requires every non-exempt paper to pass; a high average does not override a failed paper. Display percentages round to two decimals, but grade thresholds use the unrounded fraction. Example: 90/100 and 40/50 produce 130/150 = 86.67%, grade B; if each paper passes, overall result is pass.

## Permissions

| Role | Exams / candidates | Papers / mark sheet | Mark writes | Full results |
|---|---|---|---|---|
| admin | All | All | All draft, held papers | All previews/published |
| active class teacher | Assigned class | Read all papers | Only if also assigned the matching subject | Full assigned-class preview |
| active subject teacher | Assigned class/candidate names | Own subject only | Own subject, draft, held date on/after joining | Own mark sheet; no full class report |
| inactive/unassigned teacher | No assigned-class access | No | No | No |
| student | Own registered published exams | Published paper metadata | No | Own published report |
| parent | Linked children's registered published exams | Published paper metadata | No | Linked children's published reports |

All ownership checks run on the server. Removing an assignment or deactivating employment revokes access on subsequent requests. Reopening/cancelling hides family results; unlinking a parent revokes that child's reports. Lists and student filters never broaden family permissions. Mark sheets expose names, admission numbers, registered sections and mark fields, not student email, DOB, address or guardian contacts. Audit reasons/previous values/actor details are admin-only. Current subject remarks are visible in authorized report cards.

## Mark saves and corrections

GET a paper's marks to obtain version and candidate rows. PUT 1–100 distinct edited rows with expected_version; Exam JSON is limited to 128KB while other normal APIs remain 16KB. A stale version returns 409. New outcomes need no correction reason; changing saved outcome/score/remark needs a 3–200-character reason. Exempt needs its own explanatory remark. No-op saves do not increment the version or append audit. All rows, audit entries and version increments commit atomically or roll back together. Active Auth role and subject assignment/employment are checked and locked within the save transaction.

## Upgrade

Back up PostgreSQL and use the existing Modules 1–6 database:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Production uses docker-compose.prod.yml and the existing HTTPS origin/secrets with a normal maintenance window. Without Docker: run `npm ci && npm run migrate` from backend, restart the API, then run `npm ci && npm run build` from frontend and publish the rebuilt assets. No new dependencies, secrets or environment variables are required. Do not import schema.sql over an existing database: it contains the complete fresh-schema reference through Module 7.

School dates use PostgreSQL CURRENT_DATE and the database timezone configured for Attendance/Fees. /api/exams/calendar exposes the same school date. Existing enrollments/marks from legacy Laravel are not imported automatically. The migration seeds grading rules only; it creates no exams or scores.

## API

All routes require a bearer JWT and return Cache-Control: no-store. Lists use limit 1–100 (default 25) and nonnegative offset (default 0), unless described otherwise.

| Method | Path | Access / body / response |
|---|---|---|
| GET | /api/exams/calendar | Any signed-in role; `{today}` |
| GET | /api/exams/grading-scales | Any signed-in role; all scales with bands |
| POST | /api/exams/grading-scales | Admin: name, bands [{minimum_percent,label}]; 201 |
| GET | /api/exams | Scoped list; optional class_id, academic_year_id, student_id, status |
| POST | /api/exams | Admin: class_id, grading_scale_id, name, start_date, end_date; optional term_id; 201 |
| GET | /api/exams/:id | Scoped metadata, including can_class_report |
| GET | /api/exams/:id/papers | Scoped papers with can_mark |
| POST | /api/exams/:id/papers | Admin: subject_id, held_on, max_marks, pass_marks; 201 |
| PUT | /api/exams/:id/papers/:paperId | Admin: full paper fields; 200 |
| DELETE | /api/exams/:id/papers/:paperId | Admin: draft/unmarked only; 204 |
| GET | /api/exams/:id/candidates | Assigned staff/admin; paged names/registration |
| POST | /api/exams/:id/candidates | Admin: student_id; 201 |
| DELETE | /api/exams/:id/candidates/:studentId | Admin: draft, no marks; 204 |
| GET | /api/exams/:id/papers/:paperId/marks | Assigned staff/admin; `{paper, items}` |
| PUT | /api/exams/:id/papers/:paperId/marks | Admin/matching active subject teacher; `{version,changed}` |
| POST | /api/exams/:id/publish | Admin: empty `{}`; checks completeness |
| POST | /api/exams/:id/reopen | Admin: reason; hides family results |
| POST | /api/exams/:id/cancel | Admin: reason; draft → terminal cancelled |
| GET | /api/exams/:id/results | Admin/class teacher; paged full class preview |
| GET | /api/exams/:id/my-results | Admin/student/parent; scoped candidate reports |
| GET | /api/exams/:id/students/:studentId | Admin/self/linked parent; specific candidate report |
| GET | /api/exams/:id/audit | Admin: paged mark items and publication events |

Typical mark body:

```json
{
  "expected_version": 0,
  "entries": [
    {"student_id": "<UUID>", "outcome": "scored", "score": 80, "remark": null},
    {"student_id": "<another UUID>", "outcome": "exempt", "score": null, "remark": "Approved exemption"}
  ],
  "correction_reason": null
}
```

IDs are validated as UUIDs, calendar dates must be real YYYY-MM-DD values, scores/thresholds are integers, names/remarks/reasons reject markup/control characters, and unknown query/body fields are rejected. Values are parameterized in SQL. Class/year, enrollment, actor and grade values are derived server-side rather than accepted as mark input.

Errors: 400 invalid input/date/score/rule/state or incomplete publication; 401 signed out; 403 disallowed role/full-report privilege; 404 absent/inaccessible exam/paper/student or unavailable marking assignment; 409 duplicate, stale paper version, closed exam, protected reference or concurrency retry.

## Frontend

Exams & Results navigation is available to all roles. Admin creates scales/exams, configures papers, reviews candidates and uses explicit publication/reopen/cancel confirmations. Exam details show state and fixed setup, paper setup forms and registered candidate names. Subject teachers get own-subject mark sheets; class teachers get read-only sheets/full class preview unless also assigned that subject. Save/discard controls protect mark-sheet paging/closing. Stale-version errors offer reload/discard.

Families see published report cards only, with per-subject outcome/score/grade/pass/remark and weighted totals. Admin audit shows initial marks, old/new corrections and publication actions with reasons/actors. Exam/result/mark/audit views include paging, loading/error/empty states and retries. Grading scales explain threshold and pass-rule differences.

## Automated verification

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

HTTP/SQL tests run against the complete schema in embedded PostgreSQL (PGlite). Coverage includes grade validation, candidate snapshots, staff subject/class scope, atomic batches, score bounds, stale/no-op/setup versions, correction/audit rules, publication visibility, weighted/absent/exempt results, parent unlinking, reopen/republish, cancellation, protected history, pagination, Unicode batch limits and future papers/publication. Earlier module regressions and migration reruns remain included.

These tests do not replace browser or real multi-connection PostgreSQL testing.

## Acceptance checklist

1. Back up and migrate twice. schema_migrations has one 007_exams.sql row. Inspect exam tables/keys with psql. Default A–F scale exists once. Earlier modules continue to work.
2. Create a scale with unique thresholds/labels and zero threshold. Reject missing zero, duplicates, invalid labels and out-of-range/decimal thresholds. Select it for an exam; subsequent raw band modifications must fail. Default bands map exact thresholds correctly.
3. Create a class/year exam within an optional matching term. Reject wrong-year term, outside dates and duplicate active name. Verify candidates snapshot active enrollments on/before start; wrong-class/late candidates cannot be added. Add/remove eligible unmarked candidates while draft.
4. Create subject papers with whole max/pass marks and dates in the exam. Reject duplicate subject, zero/excess maximum, pass above maximum and outside dates. Editing an unmarked setup increments version; a mark save using its old version fails. Marked setup cannot change.
5. Subject teachers see/mark only their assigned subjects. Class teacher reads all papers/class preview but cannot mark a subject unless separately assigned. Inactive/unassigned teachers and cross-class/paper IDs cannot access marks. Students/parents cannot read candidate/mark-entry/full-class/audit APIs.
6. Save scored, zero, absent and exempt examples. Reject missing scored value, decimal/negative/above-max scores, non-null absent/exempt scores and exemption without an explanatory remark. Unknown/duplicate student IDs and mixed invalid batches roll back all marks/audit/version changes.
7. In two sessions load one paper version; save in one and confirm the other's stale save returns 409. Reload/discard explicitly. Identical no-op saves keep version/audit unchanged. Correcting saved score/outcome/remark requires a reason; check previous/new audit values. Audit updates/deletes are blocked.
8. Attempt publication with no papers/candidates or a missing candidate/paper outcome: reject. Future-held papers cannot be marked; future-ended exams cannot publish. After completing every pair, admin publishes successfully. Families see only their own/linked published reports, never peers' records or draft scores.
9. Check 90/100 + 40/50 → 130/150, 86.67%, grade B; failing one paper still fails overall. Absent counts zero and fails; exempt excludes maximum; all-exempt has no percentage/grade. Incomplete previews have no overall percentage/grade. Grades compare unrounded fractions even when display rounding crosses a threshold.
10. Reopen with a reason: family list/report endpoints immediately hide the exam. Correct with a reason and republish: families get the new results. Cancel a draft with a reason: terminal state, retained history, no family access; replacement may reuse its name.
11. Transfer/withdraw a registered candidate: registration/marks stay in the original exam. Referenced enrollment/student/year/section/paper/subject/rules cannot be destructively changed or deleted. Reject enrolled_on after exam start, term/year edits excluding exams and candidate removal after marks exist.
12. Remove assignments or deactivate employment while signed in: subsequent requests lose the relevant access. Unlink parent: same JWT loses the child's result immediately. Changing filters or student IDs cannot broaden access.
13. Check over-25 candidate/result/audit/exam pages, save/discard behavior, optional term/remarks, all empty/loading/error/retry states and confirmation cancellation in a browser. Restart without deleting volumes; all grades and audit history persist.
14. On real PostgreSQL, race two paper saves with the same version, a save with publish/reopen, candidate/paper changes with publication, and result reads with reopen+correction. Confirm one coherent publication snapshot, no lost marks, no incomplete publication and no draft-score leakage. Retry transactions aborted by deadlock/serialization errors.

Confirm this checklist before Module 8: Timetable. Ranking policies, period schedules and notifications remain separate modules.

## Git commands

To commit locally on top of Fees:

```sh
git switch feature/fees
git switch -c feature/exams-results
git add backend/database backend/src backend/tests frontend/src docs/testing/exams.md docs/testing/students-parents.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add exams, audited mark entry and published results"
git push -u origin feature/exams-results
```

If already published, use `git fetch origin` and `git switch --track origin/feature/exams-results` in a clean clone. This branch includes previous modules; review and merge in dependency order.
