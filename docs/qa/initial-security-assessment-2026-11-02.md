# Initial QA and security assessment — 2 November 2026

## Result and scope

The demo dataset was successfully inserted into the live application through the authenticated administrator UI after deployment of commit `777d5d3e2f7d9cdc07fd484ab19f4cdcb3c0ef6e`. The import reported success, and normal dashboard/API queries immediately showed the new related records. Existing administrator credentials and records were not modified.

Targets: `https://frontend-javx.vercel.app` and `https://school-management-knrb.onrender.com`, plus the repository's application code and dependency lockfiles. This is an initial, bounded assessment, not an exhaustive penetration test or a certification that all possible interactions are safe. Destructive operations, brute-force attempts, load testing, infrastructure changes and real payment transactions were not performed.

## Dataset verified live

- 16 student profiles, 8 parent/guardian profiles, 3 teachers and 27 non-admin demo accounts; existing administrator retained.
- 1 current demo academic year, 2 terms, 2 classes, 2 sections, 3 subjects and 16 enrollments.
- 8 teacher assignments, 2 rooms and 30 conflict-free weekly sessions.
- 80 attendance entries across the last 5 weekdays, including an audited correction.
- 3 fee structures, 17 invoices and 10 fictional manual payment records. No funds transferred.
- 1 custom grading scale, 4 exams (2 published and 2 draft), 16 registered candidates, 6 papers and 48 marks.
- 6 notices (4 currently visible, 1 scheduled, 1 draft), with 3 initial demo-user acknowledgments.
- Audit events created by the database's existing triggers.

At the first live check, attendance today was **12 present, 2 late, 1 absent and 1 excused**, for 16 recorded students and an 87.5% present-or-late share. The financial view showed **INR 72,250 outstanding / INR 51,000 overdue**, separately from **USD 125 outstanding / USD 125 overdue**. Exam publication was 2 of 4, or 50%. These are real database aggregates of fictional records, not hardcoded frontend figures.

The fixture uses DEMO labels and `example.invalid` email addresses. It generates a random password, stores only its bcrypt hash and discards the plaintext. There is no public demo login password, and no new administrator account. See [fixture design](demo-content.md).

## QA evidence

### Automated checks

| Check | Result |
|---|---|
| Backend integration suite | **52 passed, 0 failed** |
| Frontend analytics tests | **3 passed, 0 failed** |
| Frontend production build | Passed |
| Frontend dependency audit | 0 known advisories at assessment time |
| Backend dependency audit | 0 known advisories at assessment time |
| Git whitespace/error check | Passed |

Backend tests execute the complete SQL schema and its constraints/triggers in PGlite and exercise HTTP routes through Supertest. The new populated-data tests additionally verify admin-only import, trusted Origin, confirmation validation, rate limiting, dashboard counts, all main module reads, report-card access, invoice/payment/audit reads, family scoping, teacher permissions, idempotence and rollback. They verify that a successful import preserves an already-selected non-demo current year.

Existing integration suites cover authentication/session rotation and replay, password changes, role access, CRUD validation, ownership boundaries, enrollment constraints, attendance correction history, payment idempotency/overpayment/reversal rules, exam publication gates and grades, timetable conflicts and availability, notice visibility and revision-specific read acknowledgments.

### Browser and deployment checks

| Boundary | Live evidence |
|---|---|
| Deployment | Vercel production deployment for the implementation commit reported READY; Render `/api/demo` changed from unknown route to authenticated route |
| Admin → import → database → UI | Admin confirmed the import; success message appeared and dashboard aggregates populated |
| Dashboard | Correct counts, colored circular charts, current academic year, sessions and notices rendered |
| Students / parents | Directory populated; Aarav's guardian and enrollment detail displayed the linked guardian and Class 8/A placement |
| Teachers | Staff profiles and Meera's class/subject assignments displayed correctly |
| Academic setup | Demo year displayed as current with valid dates; related resources created |
| Attendance | Daily register displayed saved statuses; audit view displayed absent → present correction with reason and actor |
| Timetable | Weekday sessions, teacher names and room allocations displayed; weekends showed no sessions |
| Exams / results | Published and draft exams displayed; class preview showed subject scores, totals, exact percentages and grades |
| Fees | Paid, partial and overdue invoices displayed; invoice detail showed recorded transfer receipt, remaining balance and audit events |
| Notices | Role-targeted live notices displayed with audience and unread state; scheduled/draft records retained in management data |
| Accounts | Demo role accounts populated the directory; administrator retained |
| Browser errors | No application-origin errors observed in captured console entries; unrelated browser-extension metadata errors excluded |
| Private API access | Unauthenticated GETs to users, students, invoices, exams, timetable and notices all returned 401 |

Role isolation was tested automatically with separate local admin, teacher, student and parent sessions. Manual browser checks used the existing administrator session. Physical-device/mobile interaction, every form permutation and every possible concurrent edit were not exhaustively tested. Live financial/credential-destructive actions were not exercised; their safeguards were covered by integration tests instead.

## Findings and actions

| ID | Priority | Status | Finding and action |
|---|---|---|---|
| SEC-01 | High | Owner action required | Administrator credentials were previously disclosed in conversation and used an email-like password. Treat that credential as exposed unless already replaced. Change it privately through Security, use a unique random password, and revoke old sessions. The current password was not retrieved or changed during this assessment. Changing ADMIN_PASSWORD in Render does not reset an existing account. |
| SEC-02 | Medium | Fixed and verified live | Frontend initially lacked CSP, framing protection and nosniff headers. Added CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy and Permissions-Policy. Production response headers were rechecked after deployment. |
| SEC-03 | Medium | Fixed and verified | Several API paths did not have a global explicit cache prohibition. Added `Cache-Control: private, no-store` to `/api`; authenticated integration reads verify no-store, and live backend health response confirms the new middleware. Existing routes may override with the equivalent no-store restriction. |
| SEC-04 | Medium | Recommended follow-up | No MFA/step-up authentication is implemented for administrators. Add MFA for privileged accounts before real school records are used. This was not added as part of demo seeding. |
| SEC-05 | Low | Deployment follow-up | Rate limits use per-process memory. Verify proxy/IP attribution for the Vercel → Render path and use a shared limiter store before multiple replicas. Restart persistence and multi-replica behavior were not tested. |
| SEC-06 | Informational | Controlled | Demo import remains an authenticated administrator capability, protected by an exact trusted Origin, explicit confirmation, low rate limit, transaction/advisory lock and repeat marker. It cannot execute arbitrary SQL or return passwords. Restrict access to the existing admin account and retain the DEMO labels. |
| SEC-07 | Not assessed | Provider review required | Aiven IP filters, application database-role privileges, cloud account MFA, backup retention/restore and provider audit logs were not independently inspected. The Aiven SQL connector returned an internal error. Review those controls separately; do not infer them from a working web page. |

### Controls reviewed

- Passwords use bcrypt with cost 12; password validators limit UTF-8 length to avoid bcrypt truncation. Demo passwords are high entropy and never returned.
- JWT verification pins HS256, issuer and audience. Every authenticated request checks active account/session state. Refresh tokens are hashed in the database, rotated and replay-sensitive.
- Production refresh cookies are Secure, HttpOnly and SameSite=Strict. The browser uses the Vercel same-origin API proxy. Refresh/logout enforce the configured Origin.
- Backend authorization and family/class scoping are applied server-side. Tests deny cross-family records and staff/admin-only operations from unauthorized roles.
- SQL values use parameters; dynamically selected academic resource identifiers come from a static allowlist. Input validators and PostgreSQL constraints protect relationships and workflow transitions.
- React renders stored announcement text without `dangerouslySetInnerHTML`. No dynamic eval or token persistence in localStorage/sessionStorage was found in application source.
- Source database configuration verifies TLS certificates when a provider CA is configured; it does not disable verification. Live provider environment settings were not read.
- Helmet, configured CORS, payload limits, rate limits and redacted server-error responses are present. No tracked `.env`, `.pem` or private-key file was found.
- The frontend CSP allows inline styles for existing React style attributes but does not allow inline scripts or eval. HTTPS/HSTS responses were observed. Known dependency audit results are time-specific and do not prove absence of application vulnerabilities.

## Reproduce

```sh
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
npm audit --prefix backend
npm audit --prefix frontend
```

In the administrator UI, review each demo module, open a profile, attendance audit, published class result preview and invoice receipt. Do not reset passwords, void invoices, remove enrollments or publish real announcements solely to repeat a smoke check. Repeating Load demonstration content is safe but unnecessary: it returns an already-loaded message without overwriting records.

## Guidance used

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Web Cache Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Web_Cache_Security_Cheat_Sheet.html)
