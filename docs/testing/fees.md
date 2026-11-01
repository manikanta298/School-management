# Module 6: Fees

## Scope

Fee structures define a named charge for a class/year. Each issued invoice represents one fee structure for one student. Create distinct structures for installments or separate charges (for example, Term 1 Tuition, Term 2 Tuition and Transport). Admins manually record payments received outside the app. This module does not initiate bank/card payments or refunds, calculate taxes, discounts or late penalties, or provide general accounting/tax reporting.

Supported currencies are INR (default), USD, EUR and GBP, all using two decimal places. API amounts are positive integer minor units: INR 100.01 is amount_minor 10001. Individual structures/invoices/payments are limited to 1–1,000,000,000 minor units (0.01–10,000,000.00). The UI converts decimal strings without floating-point arithmetic, formats totals using BigInt, and rejects more than two decimal places rather than rounding. Totals are grouped by currency and never added across currencies.

## Database changes

Migration `006_fees.sql` adds:

| Table | Keys and constraints |
|---|---|
| fee_structures | UUID primary key; class/year composite FK; class-scoped case-insensitive unique name; amount/currency checks; active flag |
| fee_invoices | UUID primary key; generated invoice_number; student/structure/enrollment/creator FKs; class/year composite FK; immutable title/amount/currency/date snapshots; void fields/reason |
| fee_payments | UUID primary key; generated receipt_number; invoice/actor FKs; positive amount and method/date checks; unique UUID idempotency key; reversal fields/reason |
| fee_events | Identity primary key; invoice/payment/actor FKs; event kind, amount, reason and timestamp; append-only update/delete guard |

All reference columns have supporting indexes, including class/year, student, structure, enrollment, invoice/payment and audit actor indexes. A partial unique index permits one non-void invoice per student/structure. Voiding releases that slot so a corrected invoice can be issued; the voided invoice remains in history. Each invoice's fee/enrollment snapshot is validated by a trigger. Issuing requires an active matching enrollment and active structure, and issue date cannot precede enrollment or be in the future. Due date must be on or after issue date; it can extend beyond the academic year. Late billing after year end is allowed for an enrollment still marked active.

Editing a fee structure changes future invoices only. Existing invoices retain their original title, amount, currency and class/year. Invoice financial fields cannot be edited after issue. Correct an erroneous invoice by reversing its erroneous active payment records, voiding it with a reason and issuing a corrected invoice. Structures can be deactivated instead of deleted.

Payments are positive records against an invoice, not negative adjustments. A database trigger locks the invoice, checks date/void status and rejects overpayment, including when different clients race. No payment can precede invoice issue or be dated in the future. A payment cannot be edited; an erroneous record can be reversed once with a reason. Reversal excludes it from paid totals and restores the invoice balance; it does not transfer/refund money. Reversals and voids preserve original records. An invoice with active payments cannot be voided. Invoice/payment deletion is blocked by retained audit references; there are no deletion endpoints.

Issued invoices and payments append audit events automatically. Update/delete of fee_events is blocked. Generated invoice/receipt numbers identify records; sequence gaps are possible after failed transactions.

Fees protect referenced enrollment history: enrollment student/year identity cannot change and enrolled_on cannot move after invoice issue. Same-year class/section transfers and withdrawal/completion remain allowed; past invoices stay under the original class/year. Referenced profiles, classes, years, structures and accounts cannot be deleted.

## Permissions

| Role | Structures and writes | Invoices / payments / balances | Audit events |
|---|---|---|---|
| admin | Manage structures, issue/void invoices, record/reverse payments | All | All |
| student | No | Own only | No |
| parent | No | Linked children only | No |
| teacher | No | No | No |

Every invoice/payment/summary query applies the caller's scope, even when list filters are supplied. Inaccessible invoice IDs return 404. Unlinking a parent immediately revokes invoice/payment/balance access to that child. Students/parents never receive internal creator/void actor IDs or staff audit events. Payment reference and reversal reason are visible to the authorized student/family. No card or bank credentials are stored or requested.

## Payment retry and balance behavior

POST payment requires a UUID idempotency_key. The frontend generates one for a payment attempt and retains it across failed/retried requests. The server locks that key and invoice in a transaction. An exact retry returns the original payment/receipt with replayed=true, without adding another payment or audit event. Reusing the key with a different invoice, amount, date, method or reference returns 409. Retrying a reversed payment's original key returns the original reversed record; a genuine new payment requires a new key. If a network result is uncertain, reload and inspect receipts before creating another attempt.

Admin payment/reversal/void transactions recheck and lock the active admin account. Changes and their trigger-generated audit events commit or roll back together. Invoice-level locks serialize payment, reversal and void operations. Deadlock/serialization failures return 409 for a reload/retry.

Paid amount is the sum of unreversed payments. Balance is invoice amount minus paid amount, or zero for a void invoice. Status precedence is void, paid, overdue, partial, unpaid. A partly paid past-due invoice is overdue. Due dates before the school date are overdue; invoices due today are not overdue. Overdue amount is a subset of outstanding, not an extra charge. Void invoices are excluded from billed/paid/outstanding totals and shown separately as a count. Reversed payments do not count as paid. Aggregate amount fields are exact decimal integer strings in API responses.

## Upgrade

Back up PostgreSQL first. Apply migration on the existing Modules 1–5 database:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

For production use docker-compose.prod.yml, the existing HTTPS origin/secrets and a normal maintenance window. Without Docker: from backend run `npm ci && npm run migrate`, restart the API, then from frontend run `npm ci && npm run build` and publish the rebuilt assets. No new dependencies, secrets or environment variables are required. Do not import schema.sql over an existing database: that file is the complete fresh schema through Module 6.

School dates use PostgreSQL CURRENT_DATE and the same database timezone configured for Attendance. The frontend reads /api/fees/calendar. Verify that displayed/current dates match the school's timezone; see the Attendance guide's ALTER DATABASE timezone example and restart pool connections after changing it. Existing balances are not seeded automatically.

## API

All endpoints require JWT authentication and return Cache-Control: no-store. Teacher role is forbidden for this router. Writes and audit events require admin.

| Method | Path | Body / response |
|---|---|---|
| GET | /api/fees/calendar | `{today}` |
| GET | /api/fees/structures | Admin; `{items}` |
| POST | /api/fees/structures | class_id, name, amount_minor; optional currency (INR), active (true); 201 |
| PUT | /api/fees/structures/:id | Full structure fields; `{item}` |
| GET | /api/fees/invoices | Scoped `{items}` with paid_minor, balance_minor and computed status |
| POST | /api/fees/invoices | student_id, fee_structure_id, issued_on, due_on; 201 `{item}` |
| GET | /api/fees/invoices/:id | Scoped `{item}` |
| POST | /api/fees/invoices/:id/void | reason (3–200 plain-text characters); 204 |
| GET | /api/fees/invoices/:id/payments | Scoped `{items}` including receipt and reversal status |
| POST | /api/fees/invoices/:id/payments | amount_minor, paid_on, method, idempotency_key; optional reference; 200 `{payment_id, receipt_number, replayed}` |
| POST | /api/fees/invoices/:id/payments/:paymentId/reverse | reason (3–200 characters); 204 |
| GET | /api/fees/invoices/:id/events | Admin-only `{items}` |
| GET | /api/fees/summary | Scoped `{items}` grouped by currency |

Pagination: limit 1–100 (default 25), offset >=0 (default 0) on structures, invoices, payments and events. Structures filter by class_id/academic_year_id. Invoices filter by student_id/academic_year_id/status. Summary filters by student_id/academic_year_id and is independent of the invoice-list status filter. Filters never broaden family permissions.

Dates must be real YYYY-MM-DD calendar dates. Methods: cash, bank_transfer, cheque, other. Reference is nullable, at most 80 plain-text characters. Names are trimmed, 1–100 characters. Currency is one of the supported uppercase codes. Unknown query/body fields, malformed UUIDs, markup/control characters and non-integer amount_minor values are rejected. SQL values are parameterized.

Errors: 400 invalid input/date/amount/overpayment, void invoice or protected financial mutation; 401 signed out; 403 disallowed role/write; 404 missing/inaccessible invoice/structure; 409 duplicate structure or active invoice, retry-key mismatch, missing/protected reference, repeated reversal/void or concurrency retry condition.

## Frontend pages

Fees navigation appears for admin, student and parent. Admin Fee structures creates/edits/deactivates named class/year charges; INR is the default currency. Invoice creation lets admins select a student, then offers only structures matching active enrollments. Amount/currency are copied at issue, not entered again.

Invoice cards show status, due date and balance; detail shows the immutable charge, manual payment form, receipts/reversals and admin audit events. Reverse/void actions require explicit confirmation and a reason. A payment-record reversal clearly states that it does not refund bank funds. Students/parents have read-only invoice/payment views. Balance cards separate currencies and distinguish overdue from total outstanding. Student/year/status filters, pagination, loading/error/empty states and retries are provided.

## Automated checks

```sh
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

Fee integration tests use the complete PostgreSQL schema and actual HTTP handlers with PGlite. They cover structure/invoice snapshots, exact minor-unit amounts, duplicate billing, family scope, payment retry/replay/mismatch, overpayments/date limits, reversals/void/reissue, immutable history, currency-separated summaries, enrollment transfers and parent unlinking. Decimal parsing/large aggregate formatting are also checked. Earlier module regressions and migration reruns remain included.

These embedded checks do not replace browser acceptance or multi-connection PostgreSQL tests.

## Acceptance checklist

1. Back up and migrate twice; schema_migrations contains one 006_fees.sql row. Inspect `\d fee_structures`, `\d fee_invoices`, `\d fee_payments` and `\d fee_events`. Existing Auth, Academic, Students, Teachers and Attendance behavior remains intact.
2. Create an active class/year fee structure in INR with amount 100.01. It is stored as 10001 minor units. Reject zero/negative/excessive/fractional API amounts, more-than-two-decimal UI amounts, invalid currency/markup and duplicate class-scoped names. Check optional fields and inactive structures.
3. Issue an invoice to an actively enrolled student. A wrong-class/inactive/missing enrollment or structure cannot issue. Reject issue before enrollment, future issue and due before issue. Duplicate active invoice for student/structure returns 409. Student selector offers only matching active charges.
4. Change structure title/amount/currency and issue for another student: old invoice snapshots remain unchanged; new invoice uses new values. API clients cannot supply/change invoice amounts/currency/actor identity.
5. Record partial payments, then the exact remaining balance. Paid and balance calculations remain exact (including .01), status becomes paid, and overpayment/zero/negative/invalid-date requests fail without changing balances or audit history. Invoice due today is not overdue; partly paid past-due is overdue.
6. Retry an identical POST payment with the same idempotency_key: same payment/receipt, replayed=true, one database record/event. Change any payment field with that key or reuse it for another invoice: 409. After an uncertain network result, reload receipts before starting another attempt. No card/bank charge happens in this app.
7. Reverse a recorded payment with a reason. The record remains, paid total decreases and balance increases. Repeating reversal fails; wrong invoice/payment pairing fails. The operation records a correction and does not transfer money. A new payment uses a new UUID key.
8. Void an invoice with active payments: reject. Reverse erroneous active payments first; void with a reason succeeds. Balance becomes zero, invoice remains in history, and no new payments are allowed. Reissue the same fee after voiding: a new invoice/number is created. Double void fails.
9. Inspect admin audit: invoice issue/void and payment record/reversal show amounts, actor, timestamp and reasons. Staff-event endpoint is forbidden for parent/student/teacher. Raw UPDATE/DELETE of fee_events and editing financial fields are blocked; referenced invoices/payments cannot be deleted.
10. Students see only their own invoices/payment records/balances. Parents see linked children only. Changing invoice/student filters or payment IDs does not expose another family; individual inaccessible invoices return 404. Teacher fee endpoints return 403. All non-admin writes fail. Unlinking a parent removes access immediately using the same JWT.
11. Check INR/USD/etc balance cards remain separate. Aggregate billed/paid/outstanding exclude voids/reversals correctly; overdue is a subset of outstanding. A family with no invoices has no balance rows. Use large aggregate test amounts to check formatting without precision loss.
12. Transfer or withdraw a billed student: existing invoices retain original class/year and remain readable. Delete an invoiced enrollment/profile/structure/class/year: restricted. Changing enrolled_on after invoice issue or moving its student/year is rejected. No financial records disappear when a student leaves.
13. Check paging beyond 25 invoices, payments and audit events, all filter/empty/loading/error states and confirmation cancellation. Restart services without deleting volumes; receipts, voids and balances persist.
14. On real PostgreSQL, submit the same retry key concurrently: one payment/event is stored and both successful acknowledgments refer to it. Submit distinct-key payments each consuming the final balance: only one commits; the other is rejected without overpayment. Race a payment with reversal/void and a fee-template update with invoice issue; verify consistent snapshots, preserved events and transaction rollback, retrying deadlock-aborted operations.

Confirm these checks before Module 7: Exams & Results. Payment gateways, refunds, taxes/discounts, fee notifications, printable tax invoices and accounting exports are not implemented here.

## Git commands

To commit locally on top of Attendance:

```sh
git switch feature/attendance
git switch -c feature/fees
git add backend/database backend/src backend/tests frontend/src docs/testing/fees.md docs/testing/students-parents.md README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add fee structures, invoices and manual payment records"
git push -u origin feature/fees
```

If the branch is already published, use `git fetch origin` and `git switch --track origin/feature/fees` in a clean clone. This branch includes previous modules; review/merge in dependency order.
