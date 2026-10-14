# Plan: Renewable Active User Sessions

## Goal

Replace the fixed seven-day bearer-token session with a secure renewable session. A user who actively uses the visible web app or Chrome extension should renew silently, while abandoned and very old sessions still expire.

The current logout is expected behavior: `src/config/env.ts` defaults `JWT_EXPIRES_IN` to `7d`, `src/utils/jwt.ts` signs one fixed-expiry access JWT, and `src/middleware/auth.ts` rejects it after expiry. There is no refresh token, server-side session, or activity tracking.

## Confirmed decisions

| Decision | Resolution |
|---|---|
| Session design | Short access JWT plus rotating, database-backed refresh session |
| Access-token lifetime | 15 minutes |
| Sliding inactivity limit | 30 days |
| Absolute session limit | 180 days from login, never extended |
| Activity definition | A refresh initiated by visible, user-facing use only; hidden-tab polling and extension background work do not refresh |
| Clients | Web app and Manifest V3 Chrome extension |
| Simultaneous logins | Multiple independent sessions per user |
| Logout | Current-session logout plus logout-all endpoint |
| Existing seven-day JWTs | Continue working until their embedded expiry; they cannot be exchanged for a refresh session and require one final login |
| Rollout | Coordinated immediate cutover to 15-minute tokens; stale clients are an accepted rollout risk |
| Plan scope | File-specific backend work plus an implementation contract for client repositories, which are not in this workspace |

## API contract

Keep protected APIs on `Authorization: Bearer <accessToken>`. Refresh credentials are never returned in JSON and are sent only as an HttpOnly cookie.

### Existing login and registration

`POST /api/auth/login` and `POST /api/auth/register` retain their request bodies and existing response fields. They create an `AuthSession`, set the refresh cookie, and add expiry metadata:

```json
{
  "success": true,
  "data": {
    "user": {},
    "accessToken": "<15-minute JWT>",
    "accessTokenExpiresAt": "2026-08-15T00:15:00.000Z",
    "session": {
      "idleExpiresAt": "2026-09-14T00:00:00.000Z",
      "absoluteExpiresAt": "2027-02-11T00:00:00.000Z"
    }
  }
}
```

### New endpoints

| Method and path | Authentication | Behavior |
|---|---|---|
| `POST /api/auth/refresh` | Refresh cookie | Validate and rotate the refresh token, extend idle expiry up to the absolute cap, and return a fresh access token, current user, and expiry metadata |
| `POST /api/auth/logout` | Refresh cookie if present | Revoke only the represented session, clear the cookie, and return success idempotently |
| `POST /api/auth/logout-all` | Access bearer token | Revoke every refresh session for `req.user.userId`, clear the current cookie, and return success |

Use `200` responses in the repository's existing `{ success, data/message }` shape. A missing, invalid, expired, revoked, reused, or inactive-user refresh session returns a generic `401` and clears the cookie. An untrusted browser `Origin` returns `403`. Do not expose which refresh check failed.

## Session and token design

### Prisma model

Add `AuthSession` in `prisma/schema.prisma` and a generated migration. Add `authSessions AuthSession[]` to `User`.

Required session fields:

| Field | Purpose |
|---|---|
| `id` | CUID primary key and refresh-token session identifier |
| `userId` / `user` | Owning user with `onDelete: Cascade` |
| `refreshVersion` | Monotonic generation used to invalidate the previous refresh JWT |
| `refreshIssuedAt` | Issuance time for the current generation and deterministic race recovery |
| `lastUsedAt` | Last successful visible-use refresh |
| `idleExpiresAt` | Sliding expiry, at most `lastUsedAt + 30 days` |
| `absoluteExpiresAt` | Fixed `createdAt + 180 days` cap |
| `revokedAt` | Nullable revocation marker |
| `createdAt` / `updatedAt` | Audit timestamps |

Index `userId`, `idleExpiresAt`, and `absoluteExpiresAt`. Opportunistically delete that user's expired or long-revoked rows during login; no process-memory session state or Redis is introduced.

### Access JWT

Update `src/utils/jwt.ts` to issue explicit `HS256` access JWTs containing normalized `userId`, `email`, `role`, `sessionId`, and token type, with fixed issuer/audience checks and a 15-minute expiry. Keep `JWT_SECRET` unchanged during rollout.

Verification must support two strictly validated shapes:

1. New access tokens with type, issuer, audience, and `sessionId`.
2. Legacy tokens with the current `{ userId, email, role, iat, exp }` claims and no session ID, until their existing `exp` is reached.

Never accept refresh-token claims as access claims. Existing controllers continue receiving the normalized `req.user.userId` shape. Revocation takes effect immediately for refresh, while an already-issued access token can remain usable for at most 15 minutes.

### Rotating refresh JWT

Use a separate required `JWT_REFRESH_SECRET`. Put only `sub` (user ID), `sid` (session ID), `ver` (refresh version), token type, `iat`, and `exp` in the refresh JWT. Its `exp` is `min(idleExpiresAt, absoluteExpiresAt)`.

On refresh:

1. Verify signature, algorithm, issuer, audience, token type, and runtime claim shape.
2. Load the session and user; reject revoked/expired sessions, mismatched users, and inactive accounts.
3. If `ver` equals `refreshVersion`, atomically update the row only when the version and `revokedAt` still match. Increment the version, set `refreshIssuedAt` and `lastUsedAt`, and set `idleExpiresAt = min(now + 30 days, absoluteExpiresAt)`.
4. Sign a new refresh JWT from the committed row, set the rotated cookie, and issue an access JWT using the user's current email and role.
5. If a concurrent request presents the immediately previous version within a 10-second grace window, regenerate and return the already-current deterministic refresh JWT rather than rotating again or logging the user out.
6. If an older generation is reused outside that grace window, revoke the session and return `401`.

Use persisted `refreshIssuedAt`, `idleExpiresAt`, and explicit integer `iat`/`exp` claims so the current refresh JWT can be regenerated byte-for-byte during the concurrency grace path. Accept an injectable `now` in session helpers so boundary tests do not depend on wall-clock delays.

## Backend implementation

1. **Configuration and dependencies**
   - Update `package.json` and lockfile with cookie parsing support if needed for `req.cookies`; use Express's existing response cookie support.
   - Update `src/config/env.ts` and `.env.example` with `JWT_REFRESH_SECRET`, 30-day idle and 180-day absolute policy values, and a comma-separated exact `CHROME_EXTENSION_ORIGINS` allowlist.
   - Change the documented/default `JWT_EXPIRES_IN` to `15m`; retain the variable name because production already uses it for access tokens.
   - Validate positive durations and require a strong, stable refresh secret. Refresh-secret rotation intentionally signs every user out.
2. **Trusted origins and cookie policy**
   - Refactor the CORS origin predicate in `src/index.ts` to use exact configured web and extension origins; remove the current wildcard acceptance of every `chrome-extension://` origin.
   - Enable CORS credentials and continue reflecting one exact allowed origin, never `*`.
   - Add a small auth-origin guard for browser requests that set, rotate, or clear the refresh cookie. Reject a present untrusted `Origin`; permit a missing origin for Postman/server clients.
   - In production use a host-only `HttpOnly; Secure; SameSite=None; Path=/` refresh cookie with `Max-Age` matching the current refresh expiry. Use a non-secure local-development variant only for localhost web testing; extension cookie testing should use HTTPS staging.
   - Centralize set/clear options so logout clears the exact cookie attributes used at issuance.
3. **Database session lifecycle**
   - Add the Prisma relation/model and migration described above.
   - Refactor `src/modules/auth/auth.service.ts` so login and registration create a session and tokens. Registration's user and session creation must be transactional.
   - Implement atomic refresh rotation and concurrency grace handling without process-local locks.
   - Implement idempotent current-session revocation and user-wide revocation.
   - Update password reset so password replacement and revocation of all refresh sessions happen in one transaction.
   - Reject refresh for an inactive user. Fresh access tokens must use current database claims, so role/email changes propagate at the next refresh.
4. **JWT, controllers, and routes**
   - Update `src/utils/jwt.ts`, `src/middleware/auth.ts`, and `src/modules/auth/auth.types.ts` for modern and legacy access claims, refresh claims, expiry metadata, and strict validation.
   - Add cookie helpers within the auth module rather than spreading cookie details across controllers.
   - Update `src/modules/auth/auth.controller.ts` to set/clear cookies and add refresh/logout/logout-all handlers.
   - Update `src/modules/auth/auth.routes.ts` with the three endpoints, origin protection, and `authenticate` on logout-all.
5. **Documentation and API tooling**
   - Update `README.md` and `ENDPOINTS.md`: replace localStorage guidance for new sessions, document all endpoints, cookie/CORS requirements, 15-minute/30-day/180-day policy, one-retry behavior, and the legacy-token transition.
   - Update `Northstar-Backend.postman_collection.json` with refresh/logout requests and cookie-jar instructions. Do not place refresh credentials in collection variables.

## Web client contract

1. Send `credentials: "include"` on login, registration, refresh, and logout requests. Keep the access token in memory, not localStorage or a JavaScript-readable cookie.
2. During the migration, continue using an already-stored legacy access token until it fails. It has no refresh cookie, so a `401` leads to one final interactive login. Remove legacy persistent storage after a successful renewable login.
3. When the visible app starts/resumes or a user-driven protected request needs a token, call refresh if no valid in-memory access token exists. Do not run an interval in a hidden tab merely to keep the session alive.
4. Single-flight concurrent refreshes within a tab and coordinate tabs with Web Locks or `BroadcastChannel`. The server's 10-second generation grace remains the final race safeguard.
5. On a protected-request `401`, perform at most one refresh and retry the original request once. A refresh `401` clears client auth and redirects to login; network errors and `5xx` responses are transient and must not erase the session immediately.
6. Logout calls the server even if the access token is expired, then clears local state regardless of the response. Logout-all uses the current access token and clears local state.

## Chrome extension contract

1. Add only the exact API origin to Manifest V3 `host_permissions`, and register the extension's exact `chrome-extension://<id>` origin in backend configuration.
2. Make credentialed API calls from the extension service worker or extension pages, not content scripts. `credentials: "include"` sends the HttpOnly cookie; do not request the `cookies` permission or read the refresh cookie.
3. Store the short access token in `chrome.storage.session`, not `chrome.storage.local`. Content scripts must not receive the token; expose fixed-purpose service-worker messages rather than an arbitrary-URL fetch proxy.
4. Opening the popup/side panel or another explicit user action may refresh. Alarm handlers, hidden pages, and unattended background jobs may use a still-valid access token but must not refresh after it expires.
5. Apply the same single-flight, one-retry, definitive-`401` logout, and transient-error behavior as the web client.

## Immediate rollout

1. Create a strong stable `JWT_REFRESH_SECRET`, configure exact production web and extension origins, and preserve the current `JWT_SECRET` so issued seven-day tokens remain valid.
2. Apply the additive Prisma migration before routing traffic to code that creates sessions.
3. Coordinate deployment of the backend, web app, and extension release with `JWT_EXPIRES_IN=15m`.
4. Existing seven-day JWTs continue until their own `exp`; no server-side rows are backfilled and no legacy token can mint a refresh session. Their users log in once after expiry.
5. Monitor refresh `401` rates, missing-cookie reports, CORS failures, and extension-version adoption. The operational rollback is to restore `JWT_EXPIRES_IN=7d` for newly issued access tokens while fixing clients; do not roll back the additive session table.

Immediate cutover means an old web/extension client that logs in after deployment will receive a 15-minute access token but will not know how to refresh it. This is the accepted consequence of the selected rollout and should be called out in release notes.

## Validation

### Automated backend tests

Add auth/JWT tests using the existing `node:test` style, with deterministic clocks and mocked Prisma where appropriate:

1. New access JWT claim validation, wrong algorithm/type/issuer/audience rejection, expiry, and legacy JWT acceptance through its embedded expiry.
2. Login and registration create independent sessions and set access/session expiry metadata.
3. Refresh rotates the generation, cookie, and access token; advances idle expiry by 30 days; and never exceeds the 180-day cap.
4. Two refreshes with one token inside the 10-second grace receive the same current generation; old-token reuse outside grace revokes the session.
5. Missing, malformed, expired, revoked, absolute-expired, and inactive-user sessions return generic `401` and clear the cookie.
6. Current logout leaves other device sessions active; logout-all and password reset revoke every session.
7. Cookie attributes are correct in production mode; trusted web/extension origins receive credentialed CORS headers and arbitrary extension origins are rejected.
8. Refresh database failure returns `5xx`, not a misleading authentication failure.

Run `npm test`, `npm run build`, and `npm run lint`.

### End-to-end acceptance

1. Log in on web and extension, force the access JWT past 15 minutes, and confirm the next visible user action refreshes silently and retries once.
2. Confirm hidden-tab polling and extension background alarms do not move `lastUsedAt` or `idleExpiresAt`.
3. Confirm use within 30 days extends idle expiry, inactivity beyond 30 days requires login, and activity cannot extend a session beyond 180 days.
4. Confirm two devices refresh independently, current logout leaves the second active, and logout-all stops future refreshes everywhere. Existing access JWTs may remain usable for no more than 15 minutes.
5. Confirm a legacy seven-day JWT continues to work without a session until expiry and then requires exactly one interactive login.
6. Verify cookies on production HTTPS and extension host-permission behavior in a real Chrome profile, including browser restart and service-worker restart.

## Failure modes and boundaries

- Database or network outages must not be interpreted as session expiry by clients; only a definitive refresh `401` clears login state.
- Browser cookie blocking or incorrect `SameSite`/CORS/origin configuration causes login to appear successful but prevents renewal. Treat production cookie inspection and cross-origin smoke tests as release gates.
- Rotating `JWT_REFRESH_SECRET` invalidates all refresh cookies; rotating `JWT_SECRET` also invalidates legacy and current access tokens.
- Refresh revocation is immediate, but stateless access-token revocation is bounded by the 15-minute access lifetime.
- Password reset revokes database sessions, but legacy seven-day access JWTs issued before this rollout remain valid until their embedded expiry unless `JWT_SECRET` is rotated. This temporary rollout limitation is accepted by the legacy-token decision.

## Out of scope

- Session/device listing UI and remote revocation of one specifically selected device.
- A user-selectable "remember me" duration.
- Native/mobile refresh-token transport.
- Redis, a scheduled global session-cleanup worker, login rate limiting, and unrelated authorization/privacy findings.
