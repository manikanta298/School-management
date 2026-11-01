# Render backend deployment

The startup error naming DATABASE_URL, JWT_SECRET and FRONTEND_ORIGIN means Render has not supplied the required environment variables. A local .env file is intentionally not committed or copied into the image. Do not remove validation or commit secrets to fix this.

## Fix an existing service

Open Render Dashboard → your backend web service → Environment. Add:

| Key | Value |
| --- | --- |
| DATABASE_URL | Your PostgreSQL connection URL. For Render PostgreSQL in the same region, copy its Internal Database URL. Do not use the Docker Compose hostname `postgres` or localhost. |
| JWT_SECRET | A newly generated secret, stored only in Render. Generate locally with the command below. Keep it stable between restarts. |
| FRONTEND_ORIGIN | The actual HTTPS frontend origin, such as `https://your-school.example`, without an `/api` path. |
| NODE_ENV | `production` |
| TRUST_PROXY | `1` |

Generate a secret on your own machine and paste its output into Render's JWT_SECRET field:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Do not paste credentials into issues, chat, logs, or Git. Render supplies PORT; the server binds to 0.0.0.0.

Select **Save, rebuild, and deploy**. With the existing backend Docker image, set the Docker Command to `sh -c 'npm run migrate && npm start'` so migrations finish before traffic is accepted. This command uses the runtime environment, not the image build environment. Migration runs are transactional and serialized by a PostgreSQL advisory lock.

For this Docker setup use repository root as the service root, `./backend/Dockerfile` as Dockerfile Path and `./backend` as Docker Build Context Directory. The backend serves the API; deploy the React frontend separately using the existing frontend image/proxy setup.

For cookie-based refresh, serve `/api` through the frontend's same-origin proxy (or use compatible same-site HTTPS custom domains). Setting CORS alone does not make Strict refresh cookies work across unrelated hosting domains. The existing frontend nginx configuration proxies `/api` to the `backend` upstream; adapt that upstream for your deployment and preserve request headers. Set FRONTEND_ORIGIN to the browser-visible frontend origin.

## Blueprint for a new service

The root `render.yaml` defines a backend Docker web service. It prompts for DATABASE_URL and FRONTEND_ORIGIN and generates a persistent 256-bit JWT_SECRET. It does not create a database or deploy the frontend. Adding this file does not change the environment of an already manually created service. Use the instructions above for the failing service; do not create a duplicate just to set variables.

## Verify

1. Confirm startup no longer reports missing environment settings and migrations finish.
2. Open `https://YOUR-BACKEND/api/health`; expect `{"status":"ok"}`.
3. Configure ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME securely in the service environment, then run `npm run seed:admin` from the backend runtime shell if available. Never use the example password.
4. Sign in from the frontend, reload to exercise cookie refresh, and verify a protected API request succeeds.

The API intentionally refuses to start without a database connection or secure production configuration. This repository change cannot supply your live database credentials; they must be configured in Render.

## Database certificate chain errors

`SELF_SIGNED_CERT_IN_CHAIN` means the database TLS certificate cannot be verified. Retrying the same deployment does not change the trust settings. The sslmode warning is separate from the fatal certificate error.

If your database is **Render PostgreSQL in the same workspace and region**, copy its **Internal Database URL exactly as provided** into DATABASE_URL. Remove manually appended `sslmode=require` / `verify-full` parameters. Render's private-network internal certificates are self-signed and do not support verify-full. Do this only for that private Render connection, not an external database endpoint.

For an **external database or a provider requiring verified TLS**:

1. Download the database CA certificate bundle from your actual database provider's dashboard or official instructions. Do not copy the untrusted certificate from the error or use a made-up certificate.
2. Add `DATABASE_CA_CERT` to the Render backend Environment and paste the PEM bundle, including BEGIN/END CERTIFICATE lines. Both multiline PEM and literal `\n` line separators are supported.
3. Keep DATABASE_URL pointed at the provider's hostname. With DATABASE_CA_CERT set, the application explicitly enables TLS and verifies the certificate and hostname; URL SSL switches are removed so they cannot overwrite the trusted CA. URL client-certificate options are rejected rather than discarded.
4. Save and redeploy. The shared pool configuration applies to both the server and migrations. Check `/api/health` after startup.

For an external provider using a publicly trusted certificate, use its documented endpoint and `sslmode=verify-full`; no custom CA should be necessary. If validation still fails, confirm its required CA chain with the provider.

Do not set NODE_TLS_REJECT_UNAUTHORIZED=0 or rejectUnauthorized=false. These disable verification instead of fixing trust. No code change can discover the correct private CA or replace a live DATABASE_URL automatically.

References: [Render connection guide](https://render.com/docs/postgresql-creating-connecting), [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

## This project's Vercel frontend and Render API

- Frontend: https://frontend-javx.vercel.app
- Backend: https://school-management-knrb.onrender.com
- Frontend proxy health check: https://frontend-javx.vercel.app/api/health
- Direct backend health check: https://school-management-knrb.onrender.com/api/health

Vercel project Root Directory must be `frontend`, production branch `main`, build command `npm run build`, output `dist`. `frontend/vercel.json` forwards `/api/:path*` to Render before the SPA fallback. Browser calls stay on `/api`; keep VITE_API_BASE set to `/api` (remove any old direct Render API URL override in Vercel's environment). The committed config supplies `/api` for builds, but check for existing dashboard overrides.

On the existing Render backend service set FRONTEND_ORIGIN to `https://frontend-javx.vercel.app`, NODE_ENV to `production`, and TRUST_PROXY to `1`. render.yaml now contains this exact origin; manually created services still need their dashboard setting updated. Never use the backend URL as FRONTEND_ORIGIN. A repository push does not edit an existing service's dashboard environment.

The backend now automatically reads `/etc/secrets/ca.pem` if present, or reads an explicitly configured DATABASE_CA_CERT_FILE. The filename must be exactly `ca.pem`, with no quote; the path has no spaces. DATABASE_CA_CERT (inline PEM) takes precedence over file contents, so remove an obsolete inline value when switching to a file. A file read or certificate validation error stops startup. Use only the matching database provider CA bundle; mounting a file cannot fix an incorrect CA chain.

Pushes to the linked production branch can trigger provider auto-deployments if enabled. After both finish, check both health links, sign in from the frontend, reload to verify refresh, and confirm logout. If direct backend health fails, resolve the database/startup error first. If only the proxy health fails, check Vercel Root Directory and deployment commit. If sign-in succeeds but refresh returns 403, check the exact FRONTEND_ORIGIN and that the proxy preserves the browser Origin header. Do not weaken origin checks to accept arbitrary sites.
