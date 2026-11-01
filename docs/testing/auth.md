# Auth acceptance checklist

Run setup in README.md against PostgreSQL, then use the frontend at the configured origin.

1. Run migrations twice: both succeed; only one 001_auth.sql record exists in schema_migrations. Seed twice: only one administrator exists. Inspect database constraints/indexes with `\d users` and `\d auth_sessions` in psql.
2. Sign in with a wrong password: generic error. Correct password: admin dashboard. Inspect /api/auth/me response: no password hash or refresh token is exposed.
3. Create teacher, student and parent accounts. Duplicate email returns 409. Invalid email, unknown role, extra body fields and short/over-72-byte passwords return 400 through API. Names render as plain text.
4. Open each account in separate browser profiles; confirm its role dashboard. GET /api/users with its bearer token returns 403; missing/invalid/expired JWT returns 401. Only admin sees Manage users.
5. Reload a signed-in page: the cookie restores the session. Inspect cookie: HttpOnly and SameSite=Strict; Secure under production HTTPS. No access or refresh token should be in localStorage/sessionStorage.
6. POST /api/auth/refresh with the cookie and correct Origin: returns a new JWT/cookie. Old access token is invalidated. Reusing the old refresh cookie returns 401 and revokes all of that user's sessions. Using missing/hostile Origin returns 403. Start a fresh login afterward.
7. Change password with a wrong current password: 401. Correct current password: signed out; all other sessions for the user return 401. Old password fails, new password succeeds.
8. As admin, reset a teacher password through Manage users. Teacher sessions are revoked immediately. Teacher can log in with new password only.
9. Sign out, reload and revisit protected endpoints: session stays signed out. Logout is idempotent. Frontend reports server/network errors and does not silently clear a session if logout fails.
10. More than 20 login requests from one IP within 15 minutes return 429 (refresh/password routes share this limiter). Check Helmet headers. SQL-looking email input fails validation and does not change data. Malformed JSON returns 400.
11. Stop/restart Compose without deleting volumes: accounts persist. Test production over HTTPS and confirm only frontend is reachable publicly; database/backend remain private.

Automated HTTP+SQL coverage: backend/tests/auth.test.js. PGlite is used because the development execution environment may lack PostgreSQL/Docker. Run this checklist against the actual PostgreSQL Compose stack before approving the next module.
