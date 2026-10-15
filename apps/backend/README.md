# Northstar Backend

Express + TypeScript + Prisma + NeonDB starter with authentication.

This application is the `northstar-backend` npm workspace in the
[Northstar monorepo](../../README.md). Install dependencies from the repository
root with `npm ci`; keep backend environment variables in `apps/backend/.env`.
From the root, use `npm run dev:backend` or append
`--workspace=northstar-backend` when running other backend scripts. The commands
below also work from this application directory after the root install.

## Folder structure

```
src/
├── config/           # Environment variable validation
├── db/               # Prisma client setup
├── middleware/       # Express middleware (validation, errors)
├── modules/          # Domain modules (auth, users, ...)
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.service.ts
│   │   ├── auth.types.ts
│   │   └── auth.validation.ts
│   └── users/
│       ├── user.service.ts
│       ├── users.controller.ts
│       └── users.routes.ts
├── utils/            # Reusable helpers (hash, jwt, email, errors)
├── index.ts          # Express app / Vercel entry point
└── server.ts         # Standalone Node server entry point
```

When adding a new domain, create a folder under `src/modules/` with `*.routes.ts`, `*.controller.ts`, `*.service.ts`, and optional `*.validation.ts` / `*.types.ts`. Mount the router in `src/index.ts`.

## Public backend pages

- `/forgot-password` — request a password reset email without signing in.
- `/reset-password?token=…` — choose a new password using the emailed link; also links back to request a new email.
- `/lrt` — public timetable with date, direction and schedule filters, expandable train stops and next-day times. Neither the page nor its timetable API requires authentication.

Set `PUBLIC_BACKEND_URL` to the exact backend origin (HTTPS in production) so recovery links and same-origin recovery requests work. Configure SMTP for production email delivery. LRT requires timetable data loaded with `npm run seed:lrt --workspace=northstar-backend`.

## Auth endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Log in and create a renewable session |
| POST | `/api/auth/refresh` | Rotate the refresh credential and receive a fresh access token |
| POST | `/api/auth/logout` | Revoke the current session |
| POST | `/api/auth/logout-all` | Revoke every session for the authenticated user |
| POST | `/api/auth/forgot-password` | Request a password reset link |
| POST | `/api/auth/reset-password` | Set a new password with a reset token |

Login and registration return a short-lived access JWT in JSON and set a rotating refresh JWT as an HttpOnly cookie. Access tokens belong in memory (or `chrome.storage.session` for the extension), not `localStorage` or JavaScript-readable cookies. Protected routes continue to use `Authorization: Bearer <accessToken>`.

The access token lasts 15 minutes by default. A visible, user-driven client action can call `/api/auth/refresh` with credentials included to renew a session. Refresh activity extends the 30-day inactivity deadline but never the fixed 180-day absolute deadline. Do not refresh from hidden-tab polling or unattended extension background work.

Use the `authenticate` middleware (`src/middleware/auth.ts`) to protect routes:

```ts
import { authenticate } from "../middleware/auth";

router.get("/me", authenticate, getCurrentUser);
```

### Example requests

Register:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass1!","firstName":"Jane","lastName":"Doe"}'
```

Login:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"user@example.com","password":"StrongPass1!"}'
```

Refresh:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

Browser clients must set `credentials: "include"` on register, login, refresh, and logout requests. On a protected-request `401`, refresh and retry at most once. Only a refresh `401` is definitive authentication failure; network errors and `5xx` responses remain retryable.

Forgot password:

```bash
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Reset password:

```bash
curl -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"...","password":"NewStrongPass1!"}'
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` – NeonDB connection string
- `JWT_SECRET` - stable access-token secret (preserve it during the legacy-token transition)
- `JWT_REFRESH_SECRET` - separate stable random secret of at least 32 bytes
- `JWT_EXPIRES_IN` - access-token duration with an explicit unit, default `15m`
- `AUTH_SESSION_IDLE_EXPIRES_IN` - sliding inactivity duration, default `30d`
- `AUTH_SESSION_ABSOLUTE_EXPIRES_IN` - fixed maximum session duration, default `180d`
- `BCRYPT_SALT_ROUNDS` – default `12`
- `FRONTEND_URL` - exact comma-separated frontend web origins for CORS (not reset links)
- `PUBLIC_BACKEND_URL` - exact backend origin, e.g. `https://your-backend.vercel.app`; required HTTPS in production. Reset emails open `/reset-password` here. Defaults to `http://localhost:3000` in development; never inferred from request headers.
- `CHROME_EXTENSION_ORIGINS` - exact comma-separated `chrome-extension://<id>` origins; wildcards are rejected
- `SUPABASE_URL` - Supabase project URL used lazily by Notes image operations
- `SUPABASE_SERVICE_ROLE_KEY` - backend-only Supabase secret/service-role key
- `SUPABASE_NOTE_IMAGES_BUCKET` - private Notes image bucket, default example `note-images`
- `NOTE_IMAGE_READ_URL_TTL` - temporary signed read lifetime, default `15m`
- `NOTE_TRASH_RETENTION` - automatic trash retention, default `7d`
- `CRON_SECRET` - separate secret for the internal Notes cleanup route
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` - SMTP delivery configuration. Port 465 uses implicit TLS; other ports use STARTTLS (required in production). All four SMTP connection values are required for delivery. Development without SMTP logs links; production never logs links and reports a sanitized delivery error instead.

Production refresh cookies are host-only, `HttpOnly`, `Secure`, `SameSite=None`, and use `Path=/`. Credentialed CORS reflects only configured exact origins. Local development uses a non-secure `SameSite=Lax` cookie for localhost web testing; extension cookie acceptance must be tested against HTTPS staging.

Previously issued seven-day JWTs remain valid until their embedded expiry, but they cannot create a refresh session. Those users need one final interactive login after the legacy token expires.

## Password recovery deployment (Vercel)

Recovery starts in the extension. The email opens a responsive, branded backend page; after changing the password users return to the extension and sign in. No automatic login or browser resend form is provided. The latest link replaces previous links; tokens expire in one hour, are single-use, and reset revokes existing refresh sessions. Already-issued access JWTs remain valid until their existing short expiry.

1. Set `PUBLIC_BACKEND_URL` to the stable public backend HTTPS origin and configure all SMTP values plus a verified `EMAIL_FROM` sender in Vercel. Do not change `FRONTEND_URL` to point at the backend.
2. Apply the additive `20260823000000_add_password_reset_limits` migration with `npm run prisma:deploy` **before deploying the new routes**. It only adds a limiter table; existing accounts/tokens/sessions are unchanged. No database migration has been applied by this implementation.
3. Deploy the backend and allow sufficient function runtime for database work and SMTP timeouts (5s connect, 5s greeting, 10s socket inactivity). SMTP is awaited before the response. Provider acceptance is not proof of inbox delivery; failed delivery is logged generically, while the caller still receives the account-neutral success message. There is no background retry queue: a user requests a new email after the cooldown.
4. Verify sender SPF/DKIM/DMARC in the SMTP provider, inspect delivery/bounce logs, and test real inbox/spam placement. Never paste credentials or reset tokens into logs/issues. Production platform request logs may retain query strings; restrict access/retention and redact reset tokens in any external observability tooling.
5. Test from the extension on the deployed URL: email arrives, link opens outside the extension, weak/mismatched passwords fail, valid reset succeeds, old password fails, new password signs in, and used/expired links fail. Test narrow/mobile layout and keyboard operation. Old emails pointing at the frontend are not rewritten: request a fresh link after deployment.

Limits are durable PostgreSQL fixed windows, shared by Vercel instances: forgot-password allows 3 requests per normalized email and 10 per IP per 15 minutes; reset-password allows 10 attempts per IP per 15 minutes. Unknown emails consume the same budgets. Responses include `Retry-After`; database failures fail closed with 503. Email/IP keys are HMACs, not plaintext. On Vercel only the platform-overwritten `x-vercel-forwarded-for` is trusted; local/non-Vercel deployments use the socket IP (configure an equivalent trusted edge policy before moving hosting). Shared IPs share a budget. Configure Vercel WAF limits as additional edge protection for floods/malformed payloads.

Schedule bounded expired-row cleanup hourly in your database scheduler: run the indexed, 1,000-row `SKIP LOCKED` cleanup SQL documented in the migration, at most 10 batches per run. This is an operator setup step, not an installed cron. For rollback, deploy the previous application/remove limiter middleware first, then optionally drop `PasswordResetLimit`; this discards only limiter windows. Never drop it while new routes are active.

Tokens remain raw in the existing database fields; hash-at-rest migration is intentionally separate. Generic responses do not eliminate timing-based enumeration because SMTP is awaited only for existing accounts.

## Scripts

```bash
npm run dev       # start with nodemon + ts-node
npm run build     # compile TypeScript
npm run start     # run compiled app
npm run prisma:migrate   # create/run migrations
npm run prisma:generate  # regenerate Prisma client
npm run prisma:studio    # open Prisma Studio
npm run setup:note-storage # create/update the private Notes image bucket
```
