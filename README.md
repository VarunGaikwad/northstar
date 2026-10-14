# Northstar

One Git repository containing two independently deployed npm workspaces:

- [`apps/backend`](apps/backend): Express, TypeScript, Prisma, and Neon/PostgreSQL.
- [`apps/frontend`](apps/frontend): React, TypeScript, Tailwind, and Vite.

## Requirements

Use Node **24.17.0** (`.nvmrc`) and npm **11.13.0**. Keep application-specific
TypeScript and ESLint versions; they do not need to match.

## Install

From the repository root:

```sh
npm ci
```

There is one root `package-lock.json`. Do not create application lockfiles or
run separate application installs. Backend Prisma types are generated during
installation without database credentials or a database connection.

To add a dependency to one application, run from the root, for example:

```sh
npm install <package> --workspace=northstar-frontend
```

## Local development

Copy each application's `.env.example` to `.env` in the **same application
folder**, then supply the required values. Do not put application secrets in a
root `.env`; workspace scripts run with the application as their working directory.

- Backend: follow [`apps/backend/README.md`](apps/backend/README.md) for database,
  authentication, external-service, and origin settings. Keep `PORT=3000` for
  the existing frontend development proxy and allow `http://localhost:5173`.
- Frontend: set `VITE_API_BASE=/api` in `apps/frontend/.env` to use the local
  Vite proxy. Without an override, the code retains its existing deployed API
  fallback. Restart Vite after changing environment variables.
- Every `VITE_*` value is public browser configuration. Never put database,
  JWT, SMTP, or Supabase service-role secrets there.

Start the applications in separate terminals:

```sh
npm run dev:backend
npm run dev:frontend
```

Backend health: `http://localhost:3000/health`. Frontend: `http://localhost:5173`.
The frontend proxies `/api` to the local backend; no API routes or auth behavior
were changed by the monorepo migration.

## Commands

```sh
npm run build              # build both applications
npm run lint               # lint both using their own configurations
npm test                   # run both test suites
npm run prisma:generate    # regenerate backend Prisma types
npm run prisma:studio      # inspect the configured development database
```

Database-changing commands are explicit and require a configured `DATABASE_URL`:

```sh
npm run prisma:migrate     # create/apply development migrations
npm run prisma:deploy      # apply committed migrations to the configured database
```

Do not run migration, seed, or storage-setup commands against production as part
of repository setup. Other app-specific scripts remain available via
`npm run <script> --workspace=northstar-backend` (or `northstar-frontend`).

Backend compiled output remains `apps/backend/dist/src/server.js`; frontend
output remains `apps/frontend/dist`. Run the compiled backend with
`npm run start --workspace=northstar-backend`.

## CI and deployment

[GitHub Actions](.github/workflows/ci.yml) installs from the root and runs build,
lint, and tests. Existing backend CORS/trusted-origin test failures are not
suppressed: CI remains red until those behavior issues are fixed separately.

Deploy the applications as **two projects connected to this repository**:

| Setting | Backend | Frontend |
| --- | --- | --- |
| Root directory | `apps/backend` | `apps/frontend` |
| Node version | 24.x | 24.x |
| Install command (from app directory) | `cd ../.. && npm ci` | `cd ../.. && npm ci` |
| Build command (from app directory) | `npm run build` | `npm run build` |
| Frontend output directory | — | `dist` |

On Vercel, enable inclusion of files outside each project's root directory so
the root manifest, lockfile, and workspace apps are available during install.
The backend retains its existing `vercel.json` entry point, routes, and daily
Notes cleanup cron. Its legacy `builds` configuration can override dashboard
build/output settings; validate the actual backend function build in staging.

Keep each project's environment variables separate. Preserve current public
URLs, backend CORS origins, cookie settings, secrets, and the frontend API URL.
Changing Git layout does not require changing domains or combining deployments.
Hosting settings have **not** been changed or verified remotely.

See [`docs/monorepo-migration.md`](docs/monorepo-migration.md) for history,
verification results, staging checks, and rollback.
