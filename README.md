# Northstar Backend

Express + TypeScript + Prisma + NeonDB starter with authentication.

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
└── index.ts          # App entry point
```

When adding a new domain, create a folder under `src/modules/` with `*.routes.ts`, `*.controller.ts`, `*.service.ts`, and optional `*.validation.ts` / `*.types.ts`. Mount the router in `src/index.ts`.

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
- `FRONTEND_URL` - exact comma-separated web origins; the first is used in password-reset links
- `CHROME_EXTENSION_ORIGINS` - exact comma-separated `chrome-extension://<id>` origins; wildcards are rejected
- Optional SMTP vars to send real emails; otherwise reset links are logged to the console

Production refresh cookies are host-only, `HttpOnly`, `Secure`, `SameSite=None`, and use `Path=/`. Credentialed CORS reflects only configured exact origins. Local development uses a non-secure `SameSite=Lax` cookie for localhost web testing; extension cookie acceptance must be tested against HTTPS staging.

Previously issued seven-day JWTs remain valid until their embedded expiry, but they cannot create a refresh session. Those users need one final interactive login after the legacy token expires.

## Scripts

```bash
npm run dev       # start with nodemon + ts-node
npm run build     # compile TypeScript
npm run start     # run compiled app
npm run prisma:migrate   # create/run migrations
npm run prisma:generate  # regenerate Prisma client
npm run prisma:studio    # open Prisma Studio
```
