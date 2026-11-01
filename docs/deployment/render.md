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
