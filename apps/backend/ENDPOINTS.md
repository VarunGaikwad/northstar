# Northstar Backend — API Endpoints

> Generated from source code — Express.js REST API (TypeScript)

Base URL: `http://localhost:<PORT>` (default `3000`, configured in `.env`)

---

## Table of Contents

- [Frontend Integration Guide](#frontend-integration-guide)
- [Health & Root](#health--root)
- [Auth](#auth)
- [Users](#users)
- [Folders](#folders)
- [FavLinks](#favlinks)
- [Notes](#notes)
- [Weather](#weather)
- [LRT Timetable](#lrt-timetable)
- [Background](#background)
- [Quote of the Day](#quote-of-the-day)
- [Attendance](#attendance)
- [Error Response Format](#error-response-format)
- [TypeScript Type Definitions](#typescript-type-definitions)

---

## Frontend Integration Guide

Read this first — it covers everything a frontend app needs to know before calling any
endpoint. Endpoint-specific details are in the sections below.

### Base URL

- Default: `http://localhost:3000`
- All API routes are mounted under the `/api` prefix (except `/health` and `/`).
- The base URL has **no trailing slash**; do not double-slash paths (e.g. `/api/auth/login`, not `/api/auth/login/`).

### CORS

The backend enables credentialed CORS with an exact origin allowlist.

- `FRONTEND_URL` accepts a **single URL or a comma-separated list** of allowed origins. Every listed origin may call the API from a browser; unlisted origins are blocked. The browser's actual request origin is reflected back in `Access-Control-Allow-Origin`, and a `Vary: Origin` header is sent.
  ```env
  # One origin
  FRONTEND_URL="http://localhost:5173"
  # Multiple origins (first entry is used for password-reset email links)
  FRONTEND_URL="http://localhost:5173,http://localhost:3001,https://app.example.com"
  ```
- The **first** entry in the list is the canonical frontend URL used to build password-reset email links, so keep your primary production frontend first.
- `CHROME_EXTENSION_ORIGINS` is a comma-separated list of exact Manifest V3 origins such as `chrome-extension://<32-character-id>`. Wildcards and arbitrary extension IDs are rejected.
- Register, login, refresh, and logout browser requests must use `credentials: "include"`; otherwise the browser ignores `Set-Cookie` and does not send the refresh credential.
- If your frontend runs on an origin **not** in `FRONTEND_URL`, the browser will block the responses. You can either add it to `FRONTEND_URL`, or in dev use a **Vite/webpack dev-server proxy** forwarding `/api` to the backend (e.g. Vite `server.proxy['/api'] = { target: 'http://localhost:3000', changeOrigin: true }`) so requests share the frontend's origin.

### Authentication model

The API uses a short-lived **Bearer JWT** access token plus a rotating, database-backed refresh session.

**Obtaining a token** — call `/api/auth/login` (or `/api/auth/register`) with credentials included. The access token is returned in JSON and the refresh token is set only as an HttpOnly cookie:
```json
{
  "success": true,
  "data": {
    "user": { "id": "..." },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "2026-08-15T00:15:00.000Z",
    "session": {
      "idleExpiresAt": "2026-09-14T00:00:00.000Z",
      "absoluteExpiresAt": "2027-02-11T00:00:00.000Z"
    }
  }
}
```

**Sending a token** — keep `accessToken` in memory and attach it to every protected request:
```http
Authorization: Bearer <accessToken>
```

**Session policy** — access tokens last **15 minutes** by default. A successful visible-use refresh extends the inactivity deadline to 30 days from that refresh, capped by the fixed 180-day absolute deadline created at login. An already-issued access token can remain usable for at most its remaining lifetime after logout or session revocation.

The refresh credential is never returned in JSON and must not be stored or read by JavaScript. Production sets a host-only `HttpOnly; Secure; SameSite=None; Path=/` cookie. Local development uses a non-secure `SameSite=Lax` variant for localhost web testing.

**JWT payload** (for debugging only — do not rely on the client reading it):
```json
{ "userId": "clx...", "email": "user@example.com", "role": "USER" }
```

### Roles

- `USER` — default role assigned on registration.
- `ADMIN` — exists in the schema but **no admin-only endpoints are currently exposed**; role-based gating is reserved for future use. Treat all protected endpoints as user-scoped (each user only sees their own data).

### Response envelope

Every endpoint returns JSON. Successful responses:
```json
{ "success": true, "data": <payload> }            // most endpoints
{ "success": true, "message": "..." }             // action endpoints (delete/reset)
```
Most list endpoints put the array inside `data`; mutation endpoints put the created/updated object inside `data`. Notes pagination is the exception: `GET /api/notes` returns `data: { notes, nextCursor }`.

### Conventions the frontend should rely on

- **Timestamps** — all `createdAt`/`updatedAt`/`*At` instants are **UTC ISO 8601** strings (`2026-07-19T10:38:00.000Z`). Display them in the user's timezone on the client. The Attendance module is timezone-aware and also returns `*Local` fields (`"HH:MM"`) already converted to the record's timezone.
- **Dates** — daily keys use `YYYY-MM-DD`.
- **Times** — LRT/Attendance `HH:MM` fields are **24-hour** strings (`"5:41"`, `"19:38"`) — note the leading zero is **omitted** for hours < 10 (e.g. `"5:41"`, not `"05:41"`). Keep this in mind when sorting/parsing.
- **IDs** — opaque strings (Prisma CUIDs like `clx...`). Never assume numeric IDs.
- **Enums (string literals)** — always compare case-sensitively: `role` ∈ `{"USER","ADMIN"}`, attendance `field` ∈ `{"CHECK_IN","CHECK_OUT"}`.
- **Numbers** — weather: temperature `°C`, wind `km/h`, humidity `%`. Attendance: `workedMinutes`/`durationMins`/`stopsBetween` are integers in **minutes**.
- **Validation errors** come back as `400` with a human-readable `error` string safe to surface to users — use it to populate form-field errors.
- **Empty states** — `GET /api/attendance/me` returns `"attendance": null` when no record exists for the day; non-paginated list endpoints return `"data": []` when empty.
- **Notes concurrency** - single-note responses expose a strong `ETag`; versioned Notes mutations must echo it exactly in `If-Match`. Browser CORS allows `If-Match` and exposes `ETag`.
- **Notes empty pages** - `GET /api/notes` returns `{"success":true,"data":{"notes":[],"nextCursor":null}}` when the selected view is empty.

### Suggested auth flow on the client

```
1. POST /api/auth/login with credentials included -> keep data.accessToken + data.user in memory
2. Attach `Authorization: Bearer <token>` to protected requests
3. On visible app start/resume or one protected-request 401 -> single-flight POST /api/auth/refresh
4. Retry the original protected request at most once with the new access token
5. Clear auth only on a refresh 401; keep the session retryable on network errors and 5xx
6. POST /api/auth/logout even if the access token expired, then clear local state
```

Do not run hidden-tab refresh intervals. Coordinate tabs with Web Locks or `BroadcastChannel`; the server also tolerates the immediately previous refresh generation for 10 seconds. A Manifest V3 extension must make credentialed calls from its service worker or extension pages, use an exact API `host_permissions` entry, and store access tokens in `chrome.storage.session`. It does not need the `cookies` permission.

Legacy seven-day access JWTs issued before this rollout continue working until their embedded expiry. They have no refresh session and require one final interactive login; after renewable login succeeds, remove legacy persistent token storage.

### Suggested fetch wrapper

```ts
const API = {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = authState.accessToken; // in-memory state
    const res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body.data ?? body;
  },
};
// Usage: const user = await API.request<User>('/users/me');
```

Do not use this JSON wrapper for a Notes signed upload URL. Upload the raw image bytes directly to the returned `uploadUrl` with the returned `method` and `headers`; then call the backend confirmation endpoint as documented below.

---

## Health & Root

| Method | Path       | Auth | Description                |
|--------|------------|------|----------------------------|
| GET    | `/health`  | No   | Health check               |
| GET    | `/`        | No   | Hello world (legacy route) |

### Responses

**`GET /health`**
```json
{ "status": "ok" }
```

**`GET /`**
```
Hello, TypeScript!
```

---

## Auth

Prefix: `/api/auth`

| Method | Path                | Auth | Description                                                     |
|--------|---------------------|------|-----------------------------------------------------------------|
| POST   | `/api/auth/register` | No   | Create a new user account                                       |
| POST   | `/api/auth/login`    | No   | Authenticate and create a renewable session                     |
| POST   | `/api/auth/refresh`  | Refresh cookie | Rotate the current refresh credential and issue an access token |
| POST   | `/api/auth/logout`   | Refresh cookie if present | Revoke the current session idempotently                |
| POST   | `/api/auth/logout-all` | Bearer access token | Revoke all sessions for the current user              |
| POST   | `/api/auth/forgot-password` | No | Request a password reset (sends email if account exists)        |
| POST   | `/api/auth/reset-password` | No | Reset password using a token from the reset email               |

### POST `/api/auth/register`

**Request body**
```json
{
  "email": "user@example.com",
  "password": "Str0ng!Pass",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

**Password rules**
- Min 8 characters, max 128
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 digit
- At least 1 special character

**Response `201`**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "role": "USER",
      "isVerified": false,
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00.000Z"
    },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "2026-08-15T00:15:00.000Z",
    "session": {
      "idleExpiresAt": "2026-09-14T00:00:00.000Z",
      "absoluteExpiresAt": "2027-02-11T00:00:00.000Z"
    }
  }
}
```

The response also sets the rotating refresh credential as an HttpOnly cookie. Browser requests must include credentials and come from a configured exact origin.

**Error `409`** — duplicate email
```json
{ "success": false, "error": "An account with this email already exists" }
```

### POST `/api/auth/login`

**Request body**
```json
{
  "email": "user@example.com",
  "password": "Str0ng!Pass"
}
```

**Response `200`** — same shape and refresh cookie behavior as register.

**Error `401`**
```json
{ "success": false, "error": "Invalid email or password" }
```

**Error `403`**
```json
{ "success": false, "error": "Account is deactivated" }
```

### POST `/api/auth/refresh`

No request body or bearer token is required. The browser sends the HttpOnly refresh cookie with `credentials: "include"`. A successful request atomically rotates the credential, advances the 30-day idle deadline up to the 180-day absolute cap, and returns the same data shape as login with current user email and role claims.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "user": { "id": "clx...", "email": "user@example.com", "role": "USER" },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "2026-08-15T00:15:00.000Z",
    "session": {
      "idleExpiresAt": "2026-09-14T00:00:00.000Z",
      "absoluteExpiresAt": "2027-02-11T00:00:00.000Z"
    }
  }
}
```

Missing, malformed, expired, revoked, reused, and inactive-user sessions all return the same `401` and clear the cookie:
```json
{ "success": false, "error": "Invalid or expired refresh session" }
```

A database failure returns `500`; clients must not treat it as logout. The immediately previous refresh generation can reproduce the already-current credential during a 10-second concurrent-request grace window.

### POST `/api/auth/logout`

Uses the refresh cookie when present, revokes only that session, and clears the cookie. Missing or malformed cookies are handled idempotently.

**Response `200`**
```json
{ "success": true, "message": "Logged out successfully." }
```

### POST `/api/auth/logout-all`

Requires `Authorization: Bearer <accessToken>`. Revokes every refresh session for the authenticated user and clears the current refresh cookie. Other already-issued access tokens can remain usable until their short expiry.

**Response `200`**
```json
{ "success": true, "message": "Logged out from all sessions successfully." }
```

For register, login, refresh, logout, and logout-all, a present browser `Origin` must be in `FRONTEND_URL` or `CHROME_EXTENSION_ORIGINS`; otherwise the API returns `403`. Requests without `Origin`, such as Postman and server clients, remain allowed.

### POST `/api/auth/forgot-password`

**Request body**
```json
{
  "email": "user@example.com"
}
```

**Response `200`** (always, to avoid email enumeration)
```json
{
  "success": true,
  "message": "If an account with that email exists, a reset link has been sent."
}
```

### POST `/api/auth/reset-password`

**Request body**
```json
{
  "token": "hex-encoded-64-char-token",
  "password": "NewStr0ng!Pass"
}
```

**Response `200`**
```json
{
  "success": true,
  "message": "Password reset successfully. Please log in with your new password."
}
```

**Error `400`**
```json
{ "success": false, "error": "Invalid or expired reset token" }
```

A successful password reset revokes all database-backed refresh sessions. Legacy access JWTs issued before the renewable-session rollout remain valid until their embedded expiry.

---

## Users

Prefix: `/api/users`

| Method | Path             | Auth | Description                     |
|--------|------------------|------|---------------------------------|
| GET    | `/api/users`     | No   | List all users (no auth needed) |
| GET    | `/api/users/me`  | Yes  | Get the currently authenticated user |

### GET `/api/users`

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "email": "user@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "role": "USER",
      "isVerified": false,
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET `/api/users/me`

**Headers**
```
Authorization: Bearer <accessToken>
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "email": "user@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "USER",
    "isVerified": false,
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Error `401`**
```json
{ "success": false, "error": "Missing or invalid authorization header" }
```

---

## Folders

Prefix: `/api/folders`

All folder endpoints require authentication via `Authorization: Bearer <accessToken>`.

| Method | Path                | Auth | Description                       |
|--------|---------------------|------|-----------------------------------|
| POST   | `/api/folders`      | Yes  | Create a new folder               |
| GET    | `/api/folders`      | Yes  | List all folders for the user     |
| GET    | `/api/folders/:id`  | Yes  | Get a single folder by ID         |
| PATCH  | `/api/folders/:id`  | Yes  | Update a folder (name / parentId) |
| DELETE | `/api/folders/:id`  | Yes  | Delete a folder                   |

### POST `/api/folders`

**Request body**
```json
{
  "name": "Bookmarks",
  "parentId": "clx..."   // optional, for nested folders
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "name": "Bookmarks",
    "parentId": null,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### GET `/api/folders`

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "name": "Bookmarks",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET `/api/folders/:id`

**Response `200`** — single folder object (same shape as above)

### PATCH `/api/folders/:id`

**Request body** (at least one field required)
```json
{
  "name": "Renamed",
  "parentId": null   // set to null to move to root level
}
```

**Response `200`** — updated folder object

### DELETE `/api/folders/:id`

**Response `200`**
```json
{
  "success": true,
  "message": "Folder deleted successfully"
}
```

---

## FavLinks

Prefix: `/api/favlinks`

All favlink endpoints require authentication via `Authorization: Bearer <accessToken>`.

| Method | Path                 | Auth | Description                           |
|--------|----------------------|------|---------------------------------------|
| POST   | `/api/favlinks`      | Yes  | Create a new favlink                  |
| GET    | `/api/favlinks`      | Yes  | List favlinks (optional `folderId` query) |
| GET    | `/api/favlinks/:id`  | Yes  | Get a single favlink by ID            |
| PATCH  | `/api/favlinks/:id`  | Yes  | Update a favlink                      |
| DELETE | `/api/favlinks/:id`  | Yes  | Delete a favlink                      |

### POST `/api/favlinks`

**Request body**
```json
{
  "title": "GitHub",
  "url": "https://github.com",
  "folderId": "clx..."   // optional, omit or leave out for uncategorized
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "title": "GitHub",
    "url": "https://github.com",
    "folderId": null,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### GET `/api/favlinks`

**Query parameters**

| Param      | Type   | Required | Description                                 |
|------------|--------|----------|---------------------------------------------|
| `folderId` | string | No       | Filter favlinks by folder. Omit to get all. |

**Response `200`** — array of favlink objects

### GET `/api/favlinks/:id`

**Response `200`** — single favlink object

### PATCH `/api/favlinks/:id`

**Request body** (at least one field required)
```json
{
  "title": "Updated Title",
  "url": "https://new-url.com",
  "folderId": null     // set to null to remove from folder
}
```

**Response `200`** — updated favlink object

### DELETE `/api/favlinks/:id`

**Response `200`**
```json
{
  "success": true,
  "message": "FavLink deleted successfully"
}
```

---

## Notes

Prefix: `/api/notes`

Notes are private, user-owned plain-text records with optimistic concurrency, lifecycle views, and up to 10 ordered private images. All 13 user endpoints require `Authorization: Bearer <accessToken>`. The cleanup endpoint is internal and uses a separate cron secret, not a user JWT.

### Route summary

| Method | Path | Auth | `If-Match` | Success | Description |
|--------|------|------|------------|---------|-------------|
| POST | `/api/notes` | Bearer | No | `201` | Create a note |
| GET | `/api/notes` | Bearer | No | `200` | List one cursor page from a view |
| GET | `/api/notes/:noteId` | Bearer | No | `200` | Get one visible note |
| PATCH | `/api/notes/:noteId` | Bearer | Yes | `200` | Edit text, color, or pin state |
| POST | `/api/notes/:noteId/archive` | Bearer | Yes | `200` | Archive an active note |
| POST | `/api/notes/:noteId/unarchive` | Bearer | Yes | `200` | Return an archived note to active |
| POST | `/api/notes/:noteId/trash` | Bearer | Yes | `200` | Move an untrashed note to trash |
| POST | `/api/notes/:noteId/restore` | Bearer | Yes | `200` | Restore a trashed note to its prior state |
| DELETE | `/api/notes/:noteId` | Bearer | Yes | `202` | Claim a trashed note for permanent purge |
| POST | `/api/notes/:noteId/images/upload-intents` | Bearer | No | `201` | Reserve an image and obtain a signed upload |
| POST | `/api/notes/:noteId/images/:imageId/confirm` | Bearer | Yes | `200` | Verify and attach an uploaded image |
| PUT | `/api/notes/:noteId/images/order` | Bearer | Yes | `200` | Replace the complete ready-image order |
| DELETE | `/api/notes/:noteId/images/:imageId` | Bearer | Yes | `200` | Hide and schedule deletion of a ready image |
| GET | `/api/internal/notes/cleanup` | Cron secret | No | `200` | Run bounded retention and storage cleanup |

### Shared Notes contracts

#### IDs, ownership, and visibility

- `:noteId`, `:imageId`, and image IDs in an order request must match the exact CUID syntax `^c[a-z0-9]{24}$`; malformed IDs return `400` before a resource lookup.
- Every user resource lookup is scoped to the authenticated `userId`. A missing and a foreign note both return `404` with `"Note not found"`; a missing and a foreign image both return `404` with `"Note image not found"`.
- A note is hidden as soon as permanent purge is claimed. It then behaves as not found and cannot be read, restored, or mutated.
- Public DTOs never expose `userId`, storage paths, provider tokens/errors, image status, upload-expiry fields, or the internal purge claim.

#### `NoteDTO` and `NoteImageDTO`

Every endpoint described as returning a note uses this exact envelope and sets a strong ETag equal to the note version:

```http
ETag: "7"
```

```json
{
  "success": true,
  "data": {
    "id": "c111111111111111111111111",
    "title": "Release checklist",
    "content": "Run the smoke test before rollout.",
    "color": "BLUE",
    "isPinned": true,
    "archivedAt": null,
    "trashedAt": null,
    "version": 7,
    "createdAt": "2026-08-20T01:02:03.000Z",
    "updatedAt": "2026-08-22T04:05:06.000Z",
    "images": [
      {
        "id": "c222222222222222222222222",
        "mimeType": "image/png",
        "sizeBytes": 123456,
        "position": 0,
        "url": "<temporary signed read URL>",
        "urlExpiresAt": "2026-08-22T04:20:06.000Z"
      }
    ]
  }
}
```

```ts
type NoteDTO = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  images: NoteImageDTO[];
};

type NoteImageDTO = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
  url: string;
  urlExpiresAt: string;
};
```

Only `READY` images appear in `images`. They are ordered by `position` ascending, then `id` ascending; normal mutations keep positions contiguous and zero-based.

#### Signed image reads

- Each returned `url` is a temporary read URL for the private bucket. It is not a stable asset URL and must not be persisted as one.
- `urlExpiresAt` is the client refresh deadline computed for that response. The default lifetime is 15 minutes and is configured by `NOTE_IMAGE_READ_URL_TTL`.
- All ready images mapped in one response share one `urlExpiresAt`. A list page signs all image paths needed by that page in one provider call.
- If any required URL cannot be signed or reassociated, the entire API request returns `503`; the API never returns a partial image list.
- A zero-image response performs no storage call, so ordinary note records without images do not require Supabase at read time.
- Refetch the note or page to obtain fresh URLs after expiry.

### Strong ETag and strict `If-Match`

Single-note responses from create, get, patch, lifecycle actions, image confirmation, image reorder, and image deletion include an exact strong ETag:

```http
ETag: "7"
```

Every versioned mutation must send that value unchanged:

```http
If-Match: "7"
```

The accepted syntax is exactly `^"([1-9]\d*)"$`, and the parsed version must be a JavaScript safe integer. Weak tags, `*`, unquoted numbers, zero, signs, leading zeroes, whitespace, and tag lists are rejected.

| Condition | Status | Error |
|-----------|--------|-------|
| Header omitted | `428` | `If-Match header is required` |
| Header syntax invalid | `400` | `Invalid If-Match header` |
| Valid tag but current version differs | `412` | `Note version does not match If-Match` |

Each successful visible mutation increments `version` exactly once and returns the new ETag. Creating an upload intent and internal image cleanup do not increment it. A list response, upload-intent response, and `202` purge response do not include a note ETag. Browser CORS permits `If-Match` and exposes `ETag` to JavaScript.

### Fixed values and validation

Request bodies for create, patch, upload intent, and image order are strict JSON objects: unknown fields are rejected. Title/content whitespace is preserved and empty strings are valid; values are not trimmed.

Colors are case-sensitive and fixed:

```text
DEFAULT, RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK, BROWN, GRAY
```

| Value | Implemented rule |
|-------|------------------|
| Title length | `0..200` |
| Content length | `0..20,000` |
| Views | `active`, `archived`, `trash` |
| Page limit | `1..50`; default `30` |
| Encoded cursor length | `1..2,048` characters |
| Images per note | At most `10` combined `PENDING` plus `READY` images |
| Declared image size | Safe positive integer, at most `10,485,760` bytes (10 MiB) |
| Provisional upload reservation lifetime | 2 hours; replaced by the provider token's actual expiry before the intent is returned |
| Upload-token replay grace | 5 minutes after the provider upload token expires |
| Trash retention default | 7 days, configurable with `NOTE_TRASH_RETENTION` |
| Note cleanup claim batch | 25 |
| Image cleanup claim batch | 50 |
| Storage removal batch | 100 unique paths |
| Cleanup failure retry | 25 hours |

Image MIME values and generated extensions are fixed and case-sensitive:

| `mimeType` | Internal extension | Maximum bytes |
|------------|--------------------|---------------|
| `image/jpeg` | `jpg` | `10,485,760` |
| `image/png` | `png` | `10,485,760` |
| `image/webp` | `webp` | `10,485,760` |

An unsupported string MIME returns `415`; a missing or non-string MIME returns `400`. An integer over the byte limit returns `413`; missing, zero, negative, fractional, nonnumeric, or non-finite sizes return `400`.

### Views, ordering, and cursor pagination

#### GET `/api/notes`

**Query parameters**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `view` | enum | No | `active`, `archived`, or `trash`; default `active` |
| `limit` | integer | No | `1..50`; default `30`. A query string must be unsigned decimal without a leading zero. |
| `cursor` | string | No | Opaque canonical cursor returned by the previous page for the same view |

Unknown query fields, repeated/non-string values, invalid bounds, malformed cursors, and cursors from another view return `400`.

| View | Membership | Deterministic order |
|------|------------|---------------------|
| `active` | `trashedAt == null` and `archivedAt == null` | `isPinned DESC`, `updatedAt DESC`, `id DESC` |
| `archived` | `trashedAt == null` and `archivedAt != null` | `updatedAt DESC`, `id DESC` |
| `trash` | `trashedAt != null` | `trashedAt DESC`, `id DESC` |

Purge-claimed notes are excluded from every view. Trash membership takes precedence over the prior archive/pin fields retained on a trashed note.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "notes": [],
    "nextCursor": null
  }
}
```

`data.notes` is a `NoteDTO[]`, not a top-level array. The server fetches `limit + 1`, returns at most `limit`, and sets `nextCursor` to `null` when no further row exists.

The cursor is canonical, unpadded base64url-encoded UTF-8 JSON containing the complete descending sort tuple:

```ts
{ view: "active", isPinned: boolean, updatedAt: string, id: string }
{ view: "archived", updatedAt: string, id: string }
{ view: "trash", trashedAt: string, id: string }
```

The JSON object is strict, the timestamp must be a real ISO date-time with `Z` or a numeric offset, and `id` must be a valid CUID. The decoded bytes must re-encode to exactly the supplied base64url string, so padding and alternative non-canonical encodings fail. Do not decode, construct, edit, pad, or reuse a cursor with another view; pass `nextCursor` back unchanged with the same `view`. Under a static data set, the `id` tie-breaker prevents equal timestamps from being skipped or duplicated, and active pagination transitions from pinned to unpinned rows without returning to pinned rows.

### POST `/api/notes`

The create JSON object may be `{}`. All fields are optional:

```json
{
  "title": "Release checklist",
  "content": "Run the smoke test before rollout.",
  "color": "BLUE"
}
```

Defaults are `title: ""`, `content: ""`, `color: "DEFAULT"`, `isPinned: false`, `archivedAt: null`, `trashedAt: null`, `version: 1`, and `images: []`.

**Response `201`** - `{ "success": true, "data": <NoteDTO> }` with `ETag: "1"`.

### GET `/api/notes/:noteId`

Returns an active, archived, or trashed note as long as it belongs to the caller and purge has not been claimed. No request body or query parameters are used.

**Response `200`** - `{ "success": true, "data": <NoteDTO> }` with `ETag: "<version>"`.

### PATCH `/api/notes/:noteId`

**Request body** - at least one field is required:

```json
{
  "title": "Updated title",
  "content": "Updated plain text",
  "color": "TEAL",
  "isPinned": false
}
```

Send `If-Match: "<current version>"`. Active and archived notes may change title, content, and color. Trashed notes cannot be patched. `isPinned: true` is valid only for an active note; an archived note may receive `isPinned: false` but cannot be pinned.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

### POST `/api/notes/:noteId/archive`

No request body. Requires the current `If-Match` and an active, untrashed note. The operation sets `archivedAt`, always clears `isPinned`, and increments the version. Re-archiving or archiving trash returns `409`.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

### POST `/api/notes/:noteId/unarchive`

No request body. Requires the current `If-Match` and an archived, untrashed note. The operation clears `archivedAt` and increments the version. Unarchiving an active or trashed note returns `409`.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

### POST `/api/notes/:noteId/trash`

No request body. Requires the current `If-Match` and any untrashed note. The operation sets `trashedAt` and increments the version; it deliberately preserves `archivedAt` and `isPinned`. Trashing an already trashed note returns `409`.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

### POST `/api/notes/:noteId/restore`

No request body. Requires the current `If-Match` and an unclaimed trashed note. The operation clears only `trashedAt` and increments the version:

- A note trashed from archive returns to the archived view.
- A note trashed while active returns to the active view.
- A pinned active note retains its pin through trash and restore.

Restoring an untrashed note returns `409`; restoring after cleanup has claimed purge returns the ownership-safe `404`.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

### DELETE `/api/notes/:noteId`

Permanent delete is accepted only for a trashed note and requires the current `If-Match`. It atomically claims purge, increments the internal version, and hides the note immediately. It then advances the same bounded, idempotent purge routine used by cron.

The response does not promise that Supabase objects and database rows were synchronously removed. Storage failure or a still-replayable upload URL leaves durable cleanup work, but does not change the accepted response.

**Response `202`**

```json
{
  "success": true,
  "message": "Note deletion accepted"
}
```

Deleting an active/archived note returns `409`. A second delete after the first claim returns `404` because claimed notes are hidden.

### Image lifecycle and direct upload

Image intent creation, confirmation, reorder, and deletion are allowed for active and archived notes but never for trashed notes. A pending reservation is invisible in `NoteDTO.images`. Only confirmation makes it visible and increments the note version.

#### POST `/api/notes/:noteId/images/upload-intents`

This endpoint does not require `If-Match` and does not increment the note version.

**Request body**

```json
{
  "mimeType": "image/png",
  "sizeBytes": 123456
}
```

The service serializes reservations against the parent note, counts both pending and ready images, and rejects a combined count of 10 with `409`. It creates a unique provider path from server-owned IDs; client filenames and paths are not accepted.

**Response `201`**

```json
{
  "success": true,
  "data": {
    "imageId": "c222222222222222222222222",
    "uploadUrl": "<temporary signed upload URL>",
    "uploadExpiresAt": "2026-08-22T06:05:06.000Z",
    "method": "PUT",
    "headers": {
      "Content-Type": "image/png"
    }
  }
}
```

`uploadExpiresAt` comes from the actual signed provider token and is persisted before the URL is returned; it is not a local two-hour estimate. If provider signing or expiry validation fails, the API attempts to compensate the invisible reservation and returns a generic `503`.

#### Direct PUT sequence

1. Create the upload intent with backend bearer authentication and JSON `Content-Type`.
2. Before `uploadExpiresAt`, send the raw image bytes directly to `data.uploadUrl` using exactly `data.method` (`PUT`) and the returned `data.headers`, including the exact declared `Content-Type`.
3. Do not send the API JSON envelope, the Northstar API base URL, a backend bearer token, or any Supabase service credential to the signed upload URL.
4. Call the confirmation endpoint with backend bearer authentication and the note's current strong ETag in `If-Match`.
5. Use the confirmed `NoteDTO` and its new ETag for subsequent mutations.

The signed upload is non-upsert and each reservation has a unique server-selected path. There is no backend endpoint that accepts the image bytes themselves.

#### POST `/api/notes/:noteId/images/:imageId/confirm`

No request body. Send the note's current `If-Match`. The reservation must still be `PENDING`, the note must be untrashed/unclaimed, and confirmation must complete before the stored provider expiry. Expiry is rechecked against the PostgreSQL wall clock after acquiring the parent lock.

Before promotion, the backend reads provider object metadata and requires all of the following:

- The object exists.
- Top-level provider `size` is a safe positive integer no greater than 10 MiB.
- Provider size exactly equals the `sizeBytes` declared in the intent.
- Top-level provider `contentType` is one of the three allowed MIME values.
- Provider content type exactly equals the `mimeType` declared in the intent.

Confirmation verifies metadata; it does not expose provider metadata or paths in the response. A missing object, invalid metadata, size mismatch, or MIME mismatch tombstones the reservation, attempts object removal, and returns `422` with `"Uploaded image metadata is invalid"` without incrementing the note version. An unavailable provider returns `503`. An expired/unavailable intent returns `409`.

On success, current ready-image positions are normalized, the image is appended at the next zero-based position, and the note version increments once.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

If another visible mutation changes the version during provider I/O, confirmation returns `412` and leaves the candidate pending so it can be retried with a fresh note ETag before expiry.

#### PUT `/api/notes/:noteId/images/order`

Send the current `If-Match` and the complete desired permutation of every currently ready image ID:

```json
{
  "imageIds": [
    "c333333333333333333333333",
    "c222222222222222222222222"
  ]
}
```

The array is strict, contains at most 10 unique valid CUIDs, and may be empty only when the note has no ready images. Every supplied image must belong to this note and be `READY`, and the array length must equal the current ready-image count. The service revalidates the complete set while the parent is locked, writes each array index as `position`, and increments the note version once.

| Condition | Status |
|-----------|--------|
| Duplicate/malformed IDs or more than 10 entries | `400` |
| Missing or foreign supplied image | `404` |
| Pending/delete-pending image | `409` |
| Incomplete ready-image permutation | `409` |

**Response `200`** - `{ "success": true, "data": <updated NoteDTO> }` with the incremented ETag.

#### DELETE `/api/notes/:noteId/images/:imageId`

No request body. Send the current `If-Match`. The target must be a ready image owned through this untrashed note. The transaction immediately changes it to an internal delete-pending tombstone, removes it from the public DTO, compacts remaining positions, and increments the note version. Provider removal happens after commit and its failure does not reverse the visible mutation.

**Response `200`** - `{ "success": true, "data": <updated NoteDTO without the image> }` with the incremented ETag.

### Lifecycle and purge rules

| Current state | Read by ID | Patch | Image operations | Valid transition |
|---------------|------------|-------|------------------|------------------|
| Active | Yes | Yes | Yes | Archive or trash |
| Archived | Yes | Yes, except pinning true | Yes | Unarchive or trash |
| Trash, unclaimed | Yes | No | No | Restore or permanent delete |
| Purge claimed | Ownership-safe `404` | No | No | Cleanup only |

- Archiving clears pin state, and the database invariant disallows a pinned archived note.
- Trash preserves archive and pin fields. Restore therefore returns the note to the exact active/archived and pinned/unpinned state it had before trash.
- Automatic purge eligibility is based on `trashedAt <= now - NOTE_TRASH_RETENTION`; the default retention is seven days.
- Cleanup claims purge atomically and increments the version before hiding a note, so restore cannot win after a claim.
- The note-to-user foreign key uses delete restriction. User deletion cannot cascade away note rows while external object cleanup may still depend on them.

### Replay-safe tombstones

A signed non-upsert upload URL can remain replayable after its current object is removed. Deleting the database row immediately would allow that URL to recreate an object with no discoverable cleanup path.

For image deletion, invalid confirmation, and abandoned uploads, the implementation keeps a `DELETE_PENDING` row containing the internal path until:

```text
safeDeleteAt = uploadTokenExpiresAt + 5 minutes
```

The backend may attempt removal immediately, but it retains the tombstone and performs a final idempotent removal after `safeDeleteAt` before conditionally deleting the row. A provider `404` is treated as success. For full-note purge, the parent and all child path rows remain until the latest child safe horizon; cleanup performs the final object sweep before deleting image rows and then the note. Provider/database failures are rescheduled 25 hours later.

### GET `/api/internal/notes/cleanup`

This is the only internal Notes endpoint. It does not accept a user JWT as authorization; the request must contain exactly one authorization header in this form:

```http
Authorization: Bearer <CRON_SECRET>
```

Missing, malformed, duplicate, or nonmatching authorization returns `401` with `{"success":false,"error":"Unauthorized"}`. The supplied and configured values are SHA-256 hashed and their equal-length digests are compared with `timingSafeEqual`.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "claimedNotes": 0,
    "purgedNotes": 0,
    "deferredNotePurges": 0,
    "failedNotePurges": 0,
    "claimedUploads": 0,
    "deletedImages": 0,
    "deferredImageDeletes": 0,
    "failedImageDeletes": 0
  }
}
```

These are counts for this invocation, not totals or backlog sizes:

| Field | Meaning |
|-------|---------|
| `claimedNotes` | Retention-expired trash notes newly hidden and marked for purge |
| `purgedNotes` | Due claimed notes fully removed, including an already-absent claimed note treated idempotently |
| `deferredNotePurges` | Claimed notes retaining child paths for another bounded batch or replay-safe horizon |
| `failedNotePurges` | Claimed notes rescheduled after provider/database failure |
| `claimedUploads` | Expired pending upload reservations changed to delete-pending |
| `deletedImages` | Standalone image tombstone rows removed after final object deletion |
| `deferredImageDeletes` | Image tombstones retained until their safe replay horizon |
| `failedImageDeletes` | Image tombstones rescheduled after provider/database failure |

One invocation uses ordered `FOR UPDATE SKIP LOCKED` claims and is bounded as follows:

- At most 25 retention-expired notes are newly claimed.
- At most 25 due claimed-note purges are advanced.
- Each claimed note advances at most 100 child object paths.
- At most 50 expired pending uploads are claimed.
- At most 50 due standalone image tombstones are finalized.
- Provider removals are deduplicated and chunked at 100 paths.

Expired uploads receive an immediate removal attempt when claimed but retain their tombstone through the token replay window, then receive a final sweep. Missing provider objects and concurrently missing database rows are idempotent success. Work selected for a failed attempt is scheduled 25 hours forward so a permanent failure cannot monopolize the daily batches.

Vercel is configured to call this route daily with:

```text
0 3 * * *
```

The scheduler must send the exact `Authorization: Bearer <CRON_SECRET>` header. Never put the cron secret in a frontend, request URL, repository file, response, or log.

### Notes status table

All failures use the global error envelope `{"success":false,"error":"..."}`.

| Status | Notes meaning |
|--------|---------------|
| `200` | Read, versioned mutation, or cleanup succeeded |
| `201` | Note or upload intent created |
| `202` | Permanent purge durably accepted; physical cleanup may continue |
| `400` | Invalid strict body/query, CUID, cursor, image order, or `If-Match` syntax |
| `401` | Missing/invalid/expired user access token, or invalid cleanup secret |
| `403` | Browser origin rejected by CORS |
| `404` | Missing/foreign note or image, or note already purge-claimed |
| `409` | Invalid note/image lifecycle, image limit/order conflict, expired intent, or concurrent state race |
| `412` | Current note version does not match `If-Match` |
| `413` | Declared image size exceeds 10 MiB |
| `415` | MIME string is not one of the three supported image MIME values |
| `422` | Uploaded provider object is absent or its metadata does not exactly match the intent |
| `428` | A versioned mutation omitted `If-Match` |
| `500` | Unexpected database/configuration/runtime failure; response remains generic |
| `503` | Storage upload signing, metadata lookup, or required read-URL generation is unavailable |

Common stable errors include:

```json
{ "success": false, "error": "Note not found" }
{ "success": false, "error": "Note image not found" }
{ "success": false, "error": "Note state does not allow this operation" }
{ "success": false, "error": "Note image state does not allow this operation" }
{ "success": false, "error": "Storage service unavailable" }
```

Provider response bodies, credentials, signed tokens, and internal paths are reduced to safe API errors and are never included in a Notes response.

### Lazy environment variables

All Notes-specific settings are getters and are validated only when the corresponding Notes operation needs them. Server startup, unrelated modules, and zero-image note operations do not initialize Supabase. `CRON_SECRET` is read only while authenticating the internal cleanup request.

| Variable | Default | Validation and use |
|----------|---------|--------------------|
| `SUPABASE_URL` | None | Required for image storage/setup; nonblank valid HTTP(S) URL |
| `SUPABASE_SERVICE_ROLE_KEY` | None | Required for backend storage/setup; nonblank backend-only secret/service-role credential |
| `SUPABASE_NOTE_IMAGES_BUCKET` | None | Required for image storage/setup; matches `[a-z0-9][a-z0-9._-]{0,99}` |
| `NOTE_IMAGE_READ_URL_TTL` | `15m` | Signed read lifetime |
| `NOTE_TRASH_RETENTION` | `7d` | Automatic trash claim age |
| `CRON_SECRET` | None | Required only for cleanup authentication; nonblank |

Notes duration values require a positive integer followed by the explicit lowercase unit `ms`, `s`, `m`, `h`, or `d`. Keep the Supabase credential and cron secret in backend-only deployment secret storage. Browser clients receive only temporary signed URLs and never need the Supabase secret/service-role credential.

### Private bucket setup

After targeting the intended Supabase project and configuring the backend-only environment, run the idempotent setup command:

```bash
npm run setup:note-storage
```

The command creates the configured bucket or updates it after an existing-bucket conflict with exactly:

```ts
{
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
}
```

Keep this as a separate private bucket and do not add public read policies. Re-running the command is safe; it does not make the bucket public.

### Deployment and rollback cautions

Deployment order:

1. Use the repository's supported Node version (`>=22.12.0`).
2. Verify the exact intended Neon database and Supabase project before running setup, migration, or storage smoke commands.
3. Provision/configure the separate private bucket and backend-only Notes environment variables.
4. Run `npm run setup:note-storage` against the intended Supabase project.
5. Apply the additive Notes migration with `npm run prisma:deploy`, then run `npm run prisma:generate`.
6. Deploy the Notes routes and the Vercel daily cron together.
7. In non-production, smoke test create -> intent -> direct PUT -> confirm -> signed read -> trash/restore -> purge/cleanup before enabling clients.

The migration creates new PostgreSQL enums/tables, named check constraints, indexes, and restrictive/cascading foreign keys. Do not run a migration or destructive storage smoke test against an unidentified target.

Rollback must preserve the database path inventory needed to remove private storage objects:

1. Disable the 13 Notes user routes first.
2. Keep cleanup running while outstanding tombstones/purge claims still have recoverable paths; disable cron only when those paths remain safely recoverable by another process.
3. Preserve `Note` and `NoteImage` rows until all corresponding storage objects are enumerated and removed.
4. Drop Notes schema objects or the private bucket only after external cleanup is complete.

Do not roll back by dropping the tables first. That loses the only durable object-path inventory and can leave private storage objects orphaned.

---

## Weather

Prefix: `/api/weather`

No authentication required. Works with optional `lat` / `lon` query params for accuracy.

| Method | Path              | Auth | Description                                                                 |
|--------|-------------------|------|-----------------------------------------------------------------------------|
| GET    | `/api/weather`    | No   | Get current weather. No params → IP geolocation. Pass `lat`+`lon` for accuracy. |

### GET `/api/weather`

**Query parameters** (both optional; must be provided together)

| Param | Type   | Required | Description                            |
|-------|--------|----------|----------------------------------------|
| `lat` | number | No       | Latitude (-90 to 90)                   |
| `lon` | number | No       | Longitude (-180 to 180)                |

If `lat` and `lon` are omitted, the endpoint geolocates the request IP address via **ip-api.com** (free) to derive an approximate location, then fetches weather for that location.

If `lat` and `lon` are provided, they are used directly (more accurate).

**Response `200`**

```json
{
  "success": true,
  "data": {
    "location": {
      "city": "Hanawadamachi",
      "region": "Maharashtra",
      "country": "Japan",
      "lat": 36.5545,
      "lon": 139.9143,
      "source": "ip",
      "cityId": 1863219,
      "timezone": 32400
    },
    "weather": {
      "temperature": 32.4,
      "feelsLike": 37,
      "condition": "light rain",
      "conditionCode": 500,
      "conditionMain": "Rain",
      "conditionIcon": "10d",
      "humidity": 57,
      "pressure": 1008,
      "seaLevel": 1008,
      "grndLevel": 997,
      "tempMin": 32.4,
      "tempMax": 32.4,
      "visibility": 10000,
      "windSpeed": 1.64,
      "windDirection": 114,
      "windGust": 1.82,
      "cloudCoverage": 28,
      "rain1h": 0.46,
      "sunrise": 1784922022,
      "sunset": 1784973182,
      "country": "JP",
      "timestamp": 1784949118
    },
    "conditions": [
      { "id": 500, "main": "Rain", "description": "light rain", "icon": "10d" }
    ],
    "main": {
      "temp": 32.4,
      "feelsLike": 37,
      "tempMin": 32.4,
      "tempMax": 32.4,
      "pressure": 1008,
      "humidity": 57,
      "seaLevel": 1008,
      "grndLevel": 997
    },
    "wind": { "speed": 1.64, "deg": 114, "gust": 1.82 },
    "clouds": { "all": 28 },
    "rain": { "1h": 0.46 },
    "sys": { "country": "JP", "sunrise": 1784922022, "sunset": 1784973182 },
    "base": "stations",
    "cod": 200
  }
}
```

- `location.source` is `"ip"` when geolocated, `"user"` when `lat`/`lon` were provided. `location.city`/`cityId`/`timezone` come from OpenWeatherMap's reverse lookup at the resolved coordinates.
- `weather.conditionCode` / `weather.conditionIcon` are the OpenWeatherMap weather condition id (e.g. `500`) and icon code (e.g. `"10d"`). See the [OWM weather condition codes](https://openweathermap.org/weather-conditions).
- Convenience fields are mirrored into nested objects: `conditions[]` (the full weather array), `main` (temperature/pressure/humidity block), `wind`, `clouds`, `rain`, `sys`. `weather.*` camelCase fields remain stable for simple consumers; the nested blocks preserve the raw OpenWeatherMap shape.
- `rain` and `windGust` / `seaLevel` / `grndLevel` are **omitted when OpenWeatherMap does not return them** (no rain, no gust, non-pressure-station readings).
- Temperature in **°C**, wind speed in **m/s**, humidity in **%**, pressure in **hPa**, visibility in **metres**. Sunrise/sunset/timestamp are **Unix seconds (UTC)**.

**Example requests**

```bash
# Automatic (IP geolocation)
curl http://localhost:3000/api/weather

# Specific coordinates (more accurate)
curl "http://localhost:3000/api/weather?lat=19.076&lon=72.8777"
```

**Error `400`** — partial coordinates
```json
{ "success": false, "error": "Both lat and lon must be provided together" }
```

**Error `502`** — upstream API failure
```json
{ "success": false, "error": "Failed to determine location from IP address" }
```

---

## LRT Timetable

Prefix: `/api/lrt`

No authentication required. Serves the **Utsunomiya-Haga LRT** timetable (2026/4/1 改正) parsed from the four PDFs in `lrt/`:
inbound/outbound × weekday/holiday → **367 trips, 19 stations, 6973 stop times** in the database.

| Method | Path                 | Auth | Description                                                              |
|--------|----------------------|------|--------------------------------------------------------------------------|
| GET    | `/api/lrt/timetable` | No   | Get the full timetable for a day (auto weekday/holiday, optional filter) |
| GET    | `/api/lrt/stations` | No   | List the 19 stations in inbound order (with English/romaji names)        |
| GET    | `/api/lrt/search`    | No   | Find trains between a **from** and **to** station for a given date       |

### GET `/api/lrt/timetable`

**Query parameters** (all optional)

| Param       | Type   | Required | Description                                                                               |
|-------------|--------|----------|-------------------------------------------------------------------------------------------|
| `date`      | string | No       | `YYYY-MM-DD`. Defaults to today (UTC).                                                    |
| `direction` | enum   | No       | `INBOUND` (上り) or `OUTBOUND` (下り). Omit to return both.                              |
| `dayType`   | enum   | No       | `WEEKDAY` or `HOLIDAY`. Overrides auto-detection (e.g. force a holiday schedule on a Monday). |

**Day-type auto-detection**: Saturday, Sunday, and Japanese public holidays (祝日, 2026 set hardcoded in `lrt.service.ts`) → `HOLIDAY`; otherwise `WEEKDAY`. Override with `?dayType=`.

**Example requests**

```bash
# Today, both directions
curl http://localhost:3000/api/lrt/timetable

# A specific date, inbound only
curl "http://localhost:3000/api/lrt/timetable?date=2026-04-05&direction=INBOUND"

# Force the holiday schedule on a weekday
curl "http://localhost:3000/api/lrt/timetable?date=2026-04-06&dayType=HOLIDAY"
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "date": "2026-04-05",
    "dayType": "HOLIDAY",
    "isToday": false,
    "directions": [
      {
        "direction": "INBOUND",
        "tripCount": 80,
        "trips": [
          {
            "tripIndex": 0,
            "dayType": "HOLIDAY",
            "direction": "INBOUND",
            "trainType": "LOCAL",
            "firstDeparture": "5:41",
            "firstDepartureNextDay": false,
            "stopsServed": 7,
            "stops": [
              { "stopSequence": 0, "stationCode": 0, "stationName": "芳賀・高根沢工業団地", "stationNameEn": "Haga-Takanezawa Industrial Park", "arrival": null, "departure": null, "isNextDay": false, "stopType": "NOSERVICE" },
              { "stopSequence": 13, "stationCode": 13, "stationName": "平石", "stationNameEn": "Hiraishi", "arrival": null, "departure": "5:41", "isNextDay": false, "stopType": "STOP" },
              { "stopSequence": 18, "stationCode": 18, "stationName": "宇都宮駅東口", "stationNameEn": "Utsunomiya Station East Exit", "arrival": "5:56", "departure": null, "isNextDay": false, "stopType": "STOP" }
            ]
          }
        ]
      },
      { "direction": "OUTBOUND", "tripCount": 81, "trips": [ "..." ] }
    ]
  }
}
```

**Field notes**

- `stops` is ordered by `stopSequence` (`INBOUND` 0→18 from 芳賀・高根沢工業団地 to 宇都宮駅東口; `OUTBOUND` reversed).
- `stopType`:
  - `STOP` — train serves this station; `arrival` and/or `departure` are `"H:MM"` (24h).
  - `PASS` — a 快速 (Rapid) train passes through without stopping; times are `null`.
  - `NOSERVICE` — the train does not serve this station (short-turn origin/terminus, or padding); times are `null`.
- `isNextDay` — `true` when the time is past midnight relative to the trip's origin departure (e.g. the weekday inbound 23:52 short-turn arrives at 平石 at `0:21`).
- `stopsServed` — how many of the 19 stations this trip actually stops at (short-turns < 19).
- `trainType` — `LOCAL` (各停) or `RAPID` (快速; weekday outbound only).

**Error `400`** — malformed query
```json
{ "success": false, "error": "date is not a valid calendar date" }
```

**Error `404`** — database not seeded
```json
{ "success": false, "error": "No LRT timetable data found. Run the seed:lrt script to load the timetable." }
```

### GET `/api/lrt/stations`

**Response `200`** — 19 stations in inbound order:
```json
{
  "success": true,
  "data": {
    "stations": [
      { "code": 0,  "name": "芳賀・高根沢工業団地",         "nameEn": "Haga-Takanezawa Industrial Park", "nameRomaji": "haga-takanezawa-kogyo-danchi" },
      { "code": 13, "name": "平石",                          "nameEn": "Hiraishi",                          "nameRomaji": "hiraishi" },
      { "code": 18, "name": "宇都宮駅東口",                 "nameEn": "Utsunomiya Station East Exit",      "nameRomaji": "utsunomiya-eki-higashiguchi" }
    ]
  }
}
```

**Loading the data** (one-time):
```bash
npm run parse:lrt   # re-extract PDFs in lrt/  -> prisma/lrdata.json  (requires pdfplumber)
npm run seed:lrt    # load JSON into the database
```

### GET `/api/lrt/search`

Find all trains that run **from** one station **to** another on a given day, with departure/arrival
and travel time for each. This is the endpoint a user would call to plan a trip.

**Query parameters**

| Param          | Type   | Required | Description                                                                                          |
|----------------|--------|----------|------------------------------------------------------------------------------------------------------|
| `date`         | string | No       | `YYYY-MM-DD`. Defaults to today (UTC).                                                               |
| `from`         | string | **Yes**  | Origin station — a station **code** (`"0"`), Japanese name, English name, or romaji (case-insensitive). |
| `to`           | string | **Yes**  | Destination station — same ref formats as `from`. Must differ from `from`.                          |
| `dayType`      | enum   | No       | `WEEKDAY` or `HOLIDAY`. Overrides auto-detection.                                                    |
| `includeStops` | bool   | No       | Include the full per-station stops array per trip. Default `true`. Set `false` for a lighter payload. |

**Direction is inferred automatically** from the station codes: `from` code < `to` code → `INBOUND`
(toward Utsunomiya Station East Exit); otherwise `OUTBOUND`. Only trains that **stop at both**
endpoints are returned (short-turn and partial-service trains are filtered out). The list is
ordered by departure time at the origin station; trains departing after midnight sort last.

**Example requests**

```bash
# Whole line, weekday
curl "http://localhost:3000/api/lrt/search?date=2026-04-06&from=0&to=18"

# Reverse direction (outbound)
curl "http://localhost:3000/api/lrt/search?date=2026-04-06&from=18&to=0"

# By English station name, today, light payload
curl "http://localhost:3000/api/lrt/search?from=Hiraishi&to=Utsunomiya+Station+East+Exit&includeStops=false"
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "date": "2026-04-06",
    "dayType": "WEEKDAY",
    "isToday": false,
    "from": { "code": 0, "name": "芳賀·高根沢工業団地", "nameEn": "Haga-Takanezawa Industrial Park", "nameRomaji": "haga-takanezawa-kogyo-danchi" },
    "to":   { "code": 18, "name": "宇都宮駅東口", "nameEn": "Utsunomiya Station East Exit", "nameRomaji": "utsunomiya-eki-higashiguchi" },
    "direction": "INBOUND",
    "tripCount": 85,
    "trips": [
      {
        "tripIndex": 0,
        "trainType": "LOCAL",
        "direction": "INBOUND",
        "from": { "stationCode": 0,  "stationName": "芳賀·高根沢工業団地", "stationNameEn": "Haga-Takanezawa Industrial Park", "time": "5:26", "isNextDay": false },
        "to":   { "stationCode": 18, "stationName": "宇都宮駅東口", "stationNameEn": "Utsunomiya Station East Exit", "time": "6:10", "isNextDay": false },
        "durationMins": 44,
        "stopsBetween": 17,
        "stops": [ /* full per-station stops, same shape as /timetable ("...") */ ]
      }
    ]
  }
}
```

**Field notes**

- `from.time` = the train's **departure** at the origin station; `to.time` = its **arrival** at the destination (`"H:MM"` 24h).
- `durationMins` = `to.time − from.time`, correctly accounting for `isNextDay` (e.g. the weekday inbound 23:52 train reaches 平石 in 29 minutes the next day).
- `stopsBetween` = how many intermediate stations the passenger rides through (exclusive of the endpoints).
- `trainType` — `LOCAL` (各停) or `RAPID` (快速; weekday outbound only — a rapid train only appears here if it actually stops at **both** `from` and `to`).

**Errors**

| Status | Condition                                              |
|--------|--------------------------------------------------------|
| 400    | `from`/`to` missing, equal, or `date` malformed         |
| 404    | `from` or `to` does not match any station               |

```json
{ "success": false, "error": "from and to must be different stations" }
{ "success": false, "error": "Unknown station: \"Tokyo\"" }
```

---

## Background

Prefix: `/api/background`

No authentication required. Returns a curated Unsplash landscape photo, refreshed once per UTC day and cached in memory.

| Method | Path              | Auth | Description                  |
|--------|-------------------|------|------------------------------|
| GET    | `/api/background` | No   | Get a daily background image |

### GET `/api/background`

**Query parameters**

| Param   | Type   | Required | Description                                                              |
|---------|--------|----------|--------------------------------------------------------------------------|
| `query` | string | No       | Search term passed to Unsplash (e.g. `nature`, `city`). Defaults to `beautiful Japan Incredible India`. |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "image": {
      "url": "https://images.unsplash.com/photo-...?w=1920&h=1080&fit=crop&q=80",
      "alt": "A scenic mountain landscape",
      "unsplashUrl": "https://unsplash.com/photos/...",
      "photographer": {
        "name": "Jane Doe",
        "username": "janedoe",
        "profileUrl": "https://unsplash.com/@janedoe"
      }
    }
  }
}
```

- The same image is returned for every caller until the UTC date rolls over or the server restarts.
- When no `query` is provided, Unsplash is asked for `beautiful Japan Incredible India`.
- `url` is already sized to `1920×1080` with `fit=crop` and `q=80`.
- If the upstream Unsplash API call fails, the endpoint returns `502`.

**Error `400`** — invalid query parameter
```json
{ "success": false, "error": "Query must be a non-empty string" }
```

**Error `502`** — upstream Unsplash API failure
```json
{ "success": false, "error": "Unsplash API error: ..." }
```

---

## Quote of the Day

Prefix: `/api/quote`

No authentication required. Returns a single curated famous quote per UTC day, deterministically chosen from a bundled list.

| Method | Path         | Auth | Description                  |
|--------|--------------|------|------------------------------|
| GET    | `/api/quote` | No   | Get today's daily quote      |

### GET `/api/quote`

**Response `200`**

```json
{
  "success": true,
  "data": {
    "date": "2026-07-26",
    "index": 47,
    "quote": {
      "text": "The only way to do great work is to love what you do.",
      "author": "Steve Jobs"
    }
  }
}
```

**Field notes**

- `date` is the UTC `YYYY-MM-DD` used to select the quote.
- `index` is the 0-based position in the bundled list; useful for debugging and verifying determinism.
- `quote.text` and `quote.author` are always present.
- `quote.category` is optional and may be `"wisdom" | "life" | "work" | "courage" | "happiness"`.
- The same quote is returned until UTC midnight, then the next day's quote is selected.
- The pick is deterministic across callers and server restarts: `floor(UTC midnight epoch / 86400000) mod list.length`.

**Error `500`** — empty quote list (should never happen in production)

```json
{ "success": false, "error": "No quotes available" }
```

---

## Attendance

Prefix: `/api/attendance`

Track check-in / check-out, one of each per user per day. All endpoints require authentication — every record belongs to the authenticated user, and users can only read/correct their own records.

| Method | Path              | Auth | Description                                            |
|--------|-------------------|------|--------------------------------------------------------|
| POST   | `/`               | Yes  | Create a manual attendance record for a past date      |
| POST   | `/clock-in`       | Yes  | Clock in for today                                     |
| POST   | `/clock-out`      | Yes  | Clock out for today                                    |
| GET    | `/me`             | Yes  | Get my attendance for a day (defaults to today)        |
| GET    | `/me/range`       | Yes  | Get my attendance between two dates (inclusive)         |
| GET    | `/me/month`       | Yes  | Get my attendance for a whole month + summary stats     |
| PATCH  | `/:id`            | Yes  | Correct a record's check-in and/or check-out time      |
| GET    | `/:id/history`   | Yes  | View the full correction history (audit trail) of a record |

### How "that day" is determined

Clock-in/out **always apply to the day in the record's timezone** — the server wall-clock instant is classified into a `YYYY-MM-DD` in the supplied timezone (`?tz=` on clock endpoints, default `UTC`). A single check-in + check-out per user per day is enforced (`@@unique([userId, date])`).

All times are stored as UTC `DateTime` and rendered both as ISO 8601 (UTC) and as `HH:MM` in the record's timezone (`checkInLocal` / `checkOutLocal`). `workedMinutes` is computed as `checkOut − checkIn` in absolute UTC (null unless both are present) — so it stays correct even when check-out lands on the next UTC day (e.g. a late shift in a `+` timezone). A `checkIn` is always present for clock-in-created records; manually-created records (`POST /api/attendance`) may have only a `checkOut`, so `checkInAt` / `checkInLocal` can be `null`.

### POST `/api/attendance`

Create a manual attendance record for a **past** date (e.g. you forgot to clock in for a previous day). Today's attendance must be created via `POST /api/attendance/clock-in` instead.

**Request body**

| Field      | Type   | Required | Description                                            |
|------------|--------|----------|--------------------------------------------------------|
| `date`     | string | Yes      | `YYYY-MM-DD`. Must be a past day in `tz` (not today, not future). |
| `tz`       | string | Yes      | IANA timezone name (e.g. `Asia/Tokyo`). The day classification and time conversion use this zone. |
| `checkIn`  | string | No*      | `HH:MM` (24h) check-in time on `date`, in `tz`. |
| `checkOut` | string | No*      | `HH:MM` (24h) check-out time on `date`, in `tz`. |
| `reason`   | string | No       | Optional note (max 500 chars) recorded on the audit rows. |

\*At least one of `checkIn` / `checkOut` must be provided. If both are given, `checkOut` must be after `checkIn` (same wall-clock day in `tz`; absolute UTC ordering is enforced, so a late shift that crosses UTC midnight is still allowed as long as the wall time is later).

**Example request**

```bash
curl -X POST http://localhost:3000/api/attendance \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-20","tz":"Asia/Tokyo","checkIn":"09:00","checkOut":"18:00","reason":"forgot to clock in/out"}'
```

**Response `201`** — the created `AttendanceDTO` (same shape as clock-in, with the audit `edits[]` populated):

```json
{
  "success": true,
  "data": {
    "id": "clxxxx",
    "userId": "clyyyy",
    "date": "2026-07-20",
    "timezone": "Asia/Tokyo",
    "checkInAt": "2026-07-20T00:00:00.000Z",
    "checkOutAt": "2026-07-20T09:00:00.000Z",
    "checkInLocal": "09:00",
    "checkOutLocal": "18:00",
    "workedMinutes": 540,
    "createdAt": "...",
    "updatedAt": "...",
    "edits": [
      { "id": "cle001", "field": "CHECK_IN",  "oldValue": null, "oldValueLocal": null, "newValue": "2026-07-20T00:00:00.000Z", "newValueLocal": "09:00", "reason": "forgot to clock in/out", "editedAt": "...", "editedByUserId": "clyyyy" },
      { "id": "cle002", "field": "CHECK_OUT", "oldValue": null, "oldValueLocal": null, "newValue": "2026-07-20T09:00:00.000Z", "newValueLocal": "18:00", "reason": "forgot to clock in/out", "editedAt": "...", "editedByUserId": "clyyyy" }
    ]
  }
}
```

- One `AttendanceEdit` audit row is created **per provided field** (`CHECK_IN` and/or `CHECK_OUT`), each with `oldValue: null` and `newValue` = the supplied time. `reason` is attached to each row when provided.
- `workedMinutes` is `null` unless both `checkIn` and `checkOut` are provided.
- If only `checkOut` is provided, the record is created with `checkInAt` / `checkInLocal` = `null` (no `CHECK_IN` audit row is written).

**Errors**

| Status | Condition                                                                  |
|--------|----------------------------------------------------------------------------|
| 400    | `date` missing/malformed; `tz` missing/unknown; `checkIn`/`checkOut` not `HH:MM`; neither provided; `checkOut` not after `checkIn`; `date` is today or in the future (in `tz`) |
| 409    | An attendance record already exists for `(userId, date)` — correct it with `PATCH /:id` instead |

```json
{ "success": false, "error": "Use the clock-in endpoint for today; manual creation is for past dates" }
{ "success": false, "error": "date must not be in the future" }
{ "success": false, "error": "checkOut must be after checkIn" }
{ "success": false, "error": "provide at least one of checkIn or checkOut" }
{ "success": false, "error": "An attendance record already exists for 2026-07-20 (Asia/Tokyo) — use PATCH /:id to correct it" }
```

### POST `/api/attendance/clock-in`

**Body** (all optional)

| Field | Type   | Description                                          |
|-------|--------|------------------------------------------------------|
| `tz`  | string | IANA timezone name (e.g. `Asia/Tokyo`). Default `UTC`. |

**Response `201`**

```json
{
  "success": true,
  "data": {
    "id": "clxxxx",
    "userId": "clyyyy",
    "date": "2026-07-19",
    "timezone": "Asia/Tokyo",
    "checkInAt": "2026-07-19T10:38:00.000Z",
    "checkOutAt": null,
    "checkInLocal": "19:38",
    "checkOutLocal": null,
    "workedMinutes": null,
    "createdAt": "...",
    "updatedAt": "...",
    "edits": []
  }
}
```

**Errors**

| Status | Condition                                            |
|--------|------------------------------------------------------|
| 409    | Already clocked in today (use `PATCH /:id` to fix)    |
| 400    | Unknown timezone name                                 |

```json
{ "success": false, "error": "Already clocked in on 2026-07-19 (Asia/Tokyo) at 19:38 — use the correct endpoint to fix it" }
```

### POST `/api/attendance/clock-out`

Same body (`tz`) as clock-in. Sets `checkOutAt` on the existing record for today (in `tz`).

**Response `200`** — same shape as clock-in, with `checkOutAt` / `checkOutLocal` filled and `workedMinutes` computed.

**Errors**

| Status | Condition                                           |
|--------|-----------------------------------------------------|
| 404    | No clock-in found for today in that timezone        |
| 409    | Already clocked out today (use `PATCH /:id` to fix)  |
| 400    | Server clock-out time is before the check-in time   |

### GET `/api/attendance/me`

**Query** (all optional)

| Param  | Type   | Description                                            |
|--------|--------|--------------------------------------------------------|
| `date` | string | `YYYY-MM-DD` (in `tz`). Defaults to today in `tz`.      |
| `tz`   | string | IANA timezone name. Default `UTC`. Affects the date used and the `*Local` display formatting of the returned record. |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "date": "2026-07-19",
    "timezone": "Asia/Tokyo",
    "attendance": { /* AttendanceDTO, or null if no record that day */ }
  }
}
```

### GET `/api/attendance/me/range`

**Query**

| Param  | Type   | Required | Description                                  |
|--------|--------|----------|----------------------------------------------|
| `from` | string | Yes      | `YYYY-MM-DD` (inclusive)                       |
| `to`   | string | Yes      | `YYYY-MM-DD` (inclusive, must be `>= from`)     |
| `tz`   | string | No       | IANA timezone name. Default `UTC` (display only). |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "from": "2026-07-01",
    "to": "2026-07-31",
    "timezone": "Asia/Tokyo",
    "count": 12,
    "records": [ /* AttendanceDTO[] ordered by date ascending */ ]
  }
}
```

### GET `/api/attendance/me/month`

Get your attendance for an entire month in one call, **with a summary** of worked time. This is the convenience endpoint for a monthly attendance view.

**Query** (all optional)

| Param   | Type   | Description                                                                                          |
|---------|--------|------------------------------------------------------------------------------------------------------|
| `month` | string | `YYYY-MM` (e.g. `2026-07`). Defaults to the current month in `tz`. Must be a valid month (`01`–`12`). |
| `tz`    | string | IANA timezone name. Default `UTC`. Used to determine "current month" and to render `*Local` times.   |

The response's `from`/`to` are the first and last calendar days of the month (inclusive). `records` only includes days that have an attendance record; gaps within the month are simply absent.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "month": "2026-07",
    "timezone": "Asia/Tokyo",
    "from": "2026-07-01",
    "to": "2026-07-31",
    "daysInMonth": 31,
    "count": 1,
    "summary": {
      "daysPresent": 1,            // records with a check-in
      "daysCompleted": 1,          // records with both check-in AND check-out
      "daysClockedOutPending": 0,  // clocked in but not out yet
      "totalWorkedMinutes": 510,    // sum over completed records
      "averageWorkedMinutes": 510,  // per completed day (null if 0)
      "longestDayMinutes": 510,
      "shortestDayMinutes": 510
    },
    "records": [ /* AttendanceDTO[], ordered by date ascending */ ]
  }
}
```

**Errors**

| Status | Condition                                             |
|--------|-------------------------------------------------------|
| 400    | `month` is not `YYYY-MM`, month out of range, or unknown `tz` |

```json
{ "success": false, "error": "month must be between 01 and 12" }
{ "success": false, "error": "Unknown timezone: \"Not/A/Zone\"" }
```

### PATCH `/api/attendance/:id`

Correct a record's check-in and/or check-out. Previous values are preserved in the audit history (`AttendanceEdit` rows) — nothing is lost.

**Body** (at least one field required)

| Field      | Type   | Description                                            |
|-----------|--------|--------------------------------------------------------|
| `checkIn`  | string | New check-in time, `HH:MM` in the record's timezone.   |
| `checkOut` | string | New check-out time, `HH:MM` in the record's timezone. |
| `reason`   | string | Optional note (max 500 chars) explaining the correction. |

A correction row is recorded **only for fields that actually change**. Times are parsed against the record's own `timezone` and stored as UTC instants, so corrections are timezone-aware.

**Response `200`** — updated `AttendanceDTO`, with the new `edits[]` appended.

```json
{
  "success": true,
  "data": {
    "id": "clxxxx",
    "date": "2026-07-19",
    "timezone": "Asia/Tokyo",
    "checkInLocal": "09:00",
    "checkOutLocal": "18:00",
    "workedMinutes": 540,
    "edits": [
      {
        "id": "cle001",
        "field": "CHECK_IN",
        "oldValue": "2026-07-19T10:38:00.000Z",
        "oldValueLocal": "19:38",
        "newValue": "2026-07-19T00:00:00.000Z",
        "newValueLocal": "09:00",
        "reason": "forgot to clock in at right time",
        "editedAt": "2026-07-19T10:45:00.000Z",
        "editedByUserId": "clyyyy"
      }
    ]
  }
}
```

**Errors**

| Status | Condition                                                |
|--------|----------------------------------------------------------|
| 400    | Neither `checkIn` nor `checkOut` provided; bad `HH:MM`; or `checkOut` is before `checkIn` |
| 404    | Record not found (or doesn't belong to the caller)        |

### GET `/api/attendance/:id/history`

List the full edit history for one record (oldest first).

**Response `200`**

```json
{
  "success": true,
  "data": {
    "edits": [
      { "id": "cle001", "field": "CHECK_IN", "oldValue": "...", "oldValueLocal": "19:38", "newValue": "...", "newValueLocal": "09:00", "reason": "...", "editedAt": "...", "editedByUserId": "clyyyy" }
    ]
  }
}
```

---

## Authentication

All protected endpoints use **Bearer token** authentication.

**Header format:**
```
Authorization: Bearer <accessToken>
```

New access tokens are signed HS256 JWTs containing:
- `userId` (string)
- `email` (string)
- `role` (string: `"USER"` or `"ADMIN"`)
- `sessionId` (string)
- `tokenType` (`"access"`)
- fixed issuer and audience claims

Refresh JWTs use a separate secret and audience and are accepted only from the HttpOnly cookie by auth-session endpoints. Legacy access tokens with the old exact `{ userId, email, role, iat, exp }` shape remain accepted only until their own expiry.

---

## Error Response Format

All errors follow a consistent shape:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

| Status Code | Meaning                        |
|-------------|--------------------------------|
| 400         | Validation error               |
| 401         | Missing/invalid/expired token  |
| 403         | Forbidden, deactivated account, or rejected browser origin |
| 404         | Resource not found             |
| 409         | Duplicate resource or invalid Notes state |
| 412         | Notes `If-Match` version conflict |
| 413         | Notes image exceeds 10 MiB     |
| 415         | Unsupported Notes image MIME   |
| 422         | Uploaded Notes image metadata invalid |
| 428         | Required Notes `If-Match` missing |
| 500         | Internal server error          |
| 503         | Notes storage unavailable      |

---

## Summary — All Routes at a Glance

| # | Method | Path                     | Auth | Description                |
|---|--------|--------------------------|------|----------------------------|
| 1 | GET    | `/health`                | —    | Health check               |
| 2 | GET    | `/`                      | —    | Hello world                |
| 3 | GET    | `/api/weather`           | —    | Get weather (IP or coords) |
| 4 | POST   | `/api/auth/register`     | —    | Register                   |
| 5 | POST   | `/api/auth/login`        | —    | Login                      |
| 6 | POST   | `/api/auth/refresh`      | Cookie | Refresh current session    |
| 7 | POST   | `/api/auth/logout`       | Cookie | Logout current session     |
| 8 | POST   | `/api/auth/logout-all`   | Yes  | Logout every session         |
| 9 | POST   | `/api/auth/forgot-password` | — | Forgot password            |
|10 | POST   | `/api/auth/reset-password`  | — | Reset password             |
|11 | GET    | `/api/users`             | —    | List all users             |
|12 | GET    | `/api/users/me`          | Yes  | Get current user           |
|13 | POST   | `/api/folders`           | Yes  | Create folder              |
|14 | GET    | `/api/folders`           | Yes  | List folders               |
|15 | GET    | `/api/folders/:id`       | Yes  | Get folder by ID           |
|16 | PATCH  | `/api/folders/:id`       | Yes  | Update folder              |
|17 | DELETE | `/api/folders/:id`       | Yes  | Delete folder              |
|18 | POST   | `/api/favlinks`          | Yes  | Create favlink             |
|19 | GET    | `/api/favlinks`          | Yes  | List favlinks              |
|20 | GET    | `/api/favlinks/:id`      | Yes  | Get favlink by ID          |
|21 | PATCH  | `/api/favlinks/:id`      | Yes  | Update favlink             |
|22 | DELETE | `/api/favlinks/:id`      | Yes  | Delete favlink             |
|23 | GET    | `/api/lrt/timetable`     | —    | LRT timetable for a day    |
|24 | GET    | `/api/lrt/stations`      | —    | LRT station list (19)      |
|25 | GET    | `/api/lrt/search`        | —    | LRT trains from→to for a date |
|26 | GET    | `/api/background`        | —    | Daily background image     |
|27 | GET    | `/api/quote`             | —    | Daily quote                |
|28 | POST   | `/api/attendance`          | Yes  | Create manual attendance for a past date |
|29 | POST   | `/api/attendance/clock-in` | Yes  | Clock in for today            |
|30 | POST   | `/api/attendance/clock-out`| Yes  | Clock out for today           |
|31 | GET    | `/api/attendance/me`     | Yes  | My attendance for a day       |
|32 | GET    | `/api/attendance/me/range`| Yes  | My attendance by date range   |
|33 | GET    | `/api/attendance/me/month`| Yes  | My attendance for a month + summary |
|34 | PATCH  | `/api/attendance/:id`    | Yes  | Correct check-in/out time     |
|35 | GET    | `/api/attendance/:id/history`| Yes| Attendance correction history |
|36 | POST   | `/api/notes`             | Yes  | Create note                  |
|37 | GET    | `/api/notes`             | Yes  | List a Notes view page       |
|38 | GET    | `/api/notes/:noteId`     | Yes  | Get note by ID               |
|39 | PATCH  | `/api/notes/:noteId`     | Yes  | Edit note                    |
|40 | POST   | `/api/notes/:noteId/archive` | Yes | Archive note              |
|41 | POST   | `/api/notes/:noteId/unarchive` | Yes | Unarchive note          |
|42 | POST   | `/api/notes/:noteId/trash` | Yes | Move note to trash         |
|43 | POST   | `/api/notes/:noteId/restore` | Yes | Restore trashed note      |
|44 | DELETE | `/api/notes/:noteId`     | Yes  | Accept permanent purge       |
|45 | POST   | `/api/notes/:noteId/images/upload-intents` | Yes | Create image upload intent |
|46 | POST   | `/api/notes/:noteId/images/:imageId/confirm` | Yes | Confirm uploaded image |
|47 | PUT    | `/api/notes/:noteId/images/order` | Yes | Replace ready-image order |
|48 | DELETE | `/api/notes/:noteId/images/:imageId` | Yes | Delete ready image     |
|49 | GET    | `/api/internal/notes/cleanup` | Cron secret | Run bounded Notes cleanup |

**Total: 49 endpoints** (7 auth, 2 users, 5 folders, 5 favlinks, 8 attendance, 13 authenticated Notes user endpoints, 1 internal Notes cleanup endpoint, and 8 root/public utility endpoints)

---

## TypeScript Type Definitions

Paste-ready types for the frontend. These mirror the backend DTOs (see `src/modules/*/...types.ts`).
Replace the Prisma enum imports with the string-literal unions shown below — these are exactly
the string values the API sends on the wire (stored as UTC ISO / `YYYY-MM-DD` / `"H:MM"`).

```ts
// ── Shared responses ────────────────────────────────────────────────
export type ApiSuccess<T> = { success: true; data: T };
export type ApiMessage   = { success: true; message: string };
export type ApiError     = { success: false; error: string };

// ── Auth & Users ────────────────────────────────────────────────────
export type Role = "USER" | "ADMIN";

export interface User {
  id: string;            // Prisma CUID, e.g. "clx..."
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;     // UTC ISO 8601
}

export interface AuthResponse {
  user: User;
  accessToken: string;            // short-lived JWT, 15m default
  accessTokenExpiresAt: string;   // UTC ISO 8601
  session: {
    idleExpiresAt: string;        // slides on successful visible-use refresh
    absoluteExpiresAt: string;    // fixed at login
  };
}

// ── Folders ─────────────────────────────────────────────────────────
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── FavLinks ────────────────────────────────────────────────────────
export interface FavLink {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Notes ───────────────────────────────────────────────────────────
export type NoteColor =
  | "DEFAULT"
  | "RED"
  | "ORANGE"
  | "YELLOW"
  | "GREEN"
  | "TEAL"
  | "BLUE"
  | "PURPLE"
  | "PINK"
  | "BROWN"
  | "GRAY";

export type NoteView = "active" | "archived" | "trash";
export type NoteImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface NoteImage {
  id: string;
  mimeType: string;            // constrained to NoteImageMimeType by API/DB invariants
  sizeBytes: number;
  position: number;            // zero-based ready-image order
  url: string;                 // temporary signed private read URL
  urlExpiresAt: string;        // UTC ISO; refetch after this instant
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  version: number;             // response ETag is the quoted decimal value
  createdAt: string;
  updatedAt: string;
  images: NoteImage[];         // READY only, ordered by position
}

export interface NoteListPage {
  notes: Note[];
  nextCursor: string | null;   // opaque canonical cursor; reuse only with same view
}

export interface NoteListQuery {
  view?: NoteView;             // default "active"
  limit?: number;              // integer 1..50, default 30
  cursor?: string;             // exact nextCursor from the same view
}

export interface CreateNoteInput {
  title?: string;              // max 200; empty/whitespace preserved
  content?: string;            // max 20,000; empty/whitespace preserved
  color?: NoteColor;
}

export interface PatchNoteInput {
  title?: string;
  content?: string;
  color?: NoteColor;
  isPinned?: boolean;
}

export interface NoteImageUploadIntentInput {
  mimeType: NoteImageMimeType;
  sizeBytes: number;           // integer 1..10,485,760
}

export interface NoteImageUploadIntent {
  imageId: string;
  uploadUrl: string;
  uploadExpiresAt: string;
  method: "PUT";
  headers: {
    "Content-Type": NoteImageMimeType;
  };
}

export interface NoteImageOrderInput {
  imageIds: string[];          // complete permutation of all READY image IDs
}

export interface NoteCleanupResult {
  claimedNotes: number;
  purgedNotes: number;
  deferredNotePurges: number;
  failedNotePurges: number;
  claimedUploads: number;
  deletedImages: number;
  deferredImageDeletes: number;
  failedImageDeletes: number;
}

// ── Weather ─────────────────────────────────────────────────────────
export interface WeatherLocation {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  source: "ip" | "user";     // "ip" = geolocated, "user" = lat/lon supplied
  cityId: number | null;     // OWM city id, or null before lookup
  timezone: number | null;   // shift in seconds from UTC
}

export interface WeatherConditions {
  temperature: number;        // °C
  feelsLike: number;          // °C
  condition: string;          // OWM description, e.g. "light rain"
  conditionCode: number;      // OWM weather id, e.g. 500
  conditionMain: string;      // OWM main, e.g. "Rain"
  conditionIcon: string;      // OWM icon code, e.g. "10d"
  humidity: number;           // %
  pressure: number;           // hPa
  seaLevel?: number;          // hPa
  grndLevel?: number;         // hPa
  tempMin: number;            // °C
  tempMax: number;            // °C
  visibility: number;        // metres
  windSpeed: number;         // m/s
  windDirection: number;     // degrees
  windGust?: number;          // m/s
  cloudCoverage: number;     // %
  rain1h?: number;            // mm in last hour
  sunrise: number;            // Unix seconds (UTC)
  sunset: number;             // Unix seconds (UTC)
  country: string;            // ISO 3166 country code (from sys)
  timestamp: number;          // Unix seconds (UTC) of the observation
}

export interface WeatherConditionEntry {
  id: number;
  main: string;
  description: string;
  icon: string;
}

export interface WeatherMain {
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  pressure: number;
  humidity: number;
  seaLevel?: number;
  grndLevel?: number;
}

export interface WeatherWind {
  speed: number;
  deg: number;
  gust?: number;
}

export interface WeatherSys {
  country: string;
  sunrise: number;
  sunset: number;
}

export interface WeatherResponse {
  location: WeatherLocation;
  weather: WeatherConditions;          // camelCase convenience block
  conditions: WeatherConditionEntry[];   // raw OWM weather array
  main: WeatherMain;
  wind: WeatherWind;
  clouds: { all: number };
  rain?: { "1h": number };
  sys: WeatherSys;
  base: string;
  cod: number;
}

// ── Background ──────────────────────────────────────────────────────
export interface PhotographerCredit {
  name: string;
  username: string;
  profileUrl: string;
}

export interface BackgroundImage {
  url: string;            // 1920x1080 cropped Unsplash image URL
  alt: string | null;     // Photo description
  unsplashUrl: string;    // Link to the photo on Unsplash
  photographer: PhotographerCredit;
}

export interface BackgroundResponse {
  image: BackgroundImage;
}

// ── Quote of the Day ────────────────────────────────────────────────
export type QuoteCategory = "wisdom" | "life" | "work" | "courage" | "happiness";

export interface Quote {
  text: string;
  author: string;
  category?: QuoteCategory;
}

export interface QuoteResponse {
  date: string;  // YYYY-MM-DD (UTC)
  index: number; // 0-based position in the bundled list
  quote: Quote;
}

// ── LRT Timetable ──────────────────────────────────────────────────
export type LrtDayType   = "WEEKDAY" | "HOLIDAY";
export type LrtDirection = "INBOUND" | "OUTBOUND";
export type LrtTrainType = "LOCAL" | "RAPID";
export type LrtStopType  = "STOP" | "PASS" | "NOSERVICE";

export interface Station {
  code: number;            // 0..18, inbound order
  name: string;            // Japanese
  nameEn: string | null;
  nameRomaji: string | null;
}

export interface Stop {
  stopSequence: number;
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  arrival: string | null;   // "H:MM" 24h (leading zero omitted)
  departure: string | null; // "H:MM" 24h
  isNextDay: boolean;
  stopType: LrtStopType;
}

export interface Trip {
  tripIndex: number;
  dayType: LrtDayType;
  direction: LrtDirection;
  trainType: LrtTrainType;
  firstDeparture: string;
  firstDepartureNextDay: boolean;
  stopsServed: number;
  stops: Stop[];
}

export interface DirectionTimetable {
  direction: LrtDirection;
  tripCount: number;
  trips: Trip[];
}

export interface LrtTimetableResponse {
  date: string;            // YYYY-MM-DD
  dayType: LrtDayType;
  isToday: boolean;
  directions: DirectionTimetable[];
}

export interface LrtStationsResponse { stations: Station[] }

// ── LRT Route search ────────────────────────────────────────────────
export interface RouteStop {
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  time: string | null;     // departure at origin / arrival at destination
  isNextDay: boolean;
}

export interface RouteTrip {
  tripIndex: number;
  trainType: LrtTrainType;
  direction: LrtDirection;
  from: RouteStop;
  to: RouteStop;
  durationMins: number;
  stopsBetween: number;    // intermediate stations, exclusive of endpoints
  stops: Stop[];           // full journey, same shape as /timetable
}

export interface LrtRouteSearchResponse {
  date: string;
  dayType: LrtDayType;
  isToday: boolean;
  from: Station;
  to: Station;
  direction: LrtDirection;
  tripCount: number;
  trips: RouteTrip[];
}

// ── Attendance ─────────────────────────────────────────────────────
export type AttendanceField = "CHECK_IN" | "CHECK_OUT";

export interface AttendanceEdit {
  id: string;
  field: AttendanceField;
  oldValue: string | null;     // UTC ISO
  oldValueLocal: string | null;// "HH:MM" in record tz
  newValue: string | null;
  newValueLocal: string | null;
  reason: string | null;
  editedAt: string;            // UTC ISO
  editedByUserId: string;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string;               // YYYY-MM-DD (record's timezone)
  timezone: string;           // IANA name, e.g. "Asia/Tokyo"
  checkInAt: string | null;   // UTC ISO
  checkOutAt: string | null;
  checkInLocal: string | null;
  checkOutLocal: string | null;
  workedMinutes: number | null;// null until checked out
  createdAt: string;
  updatedAt: string;
  edits: AttendanceEdit[];
}

export interface AttendanceDay {
  date: string;
  timezone: string;
  attendance: Attendance | null; // null when no record that day
}

export interface AttendanceRange {
  from: string;
  to: string;
  timezone: string;
  count: number;
  records: Attendance[];      // ordered by date ascending
}

export interface AttendanceSummary {
  daysPresent: number;
  daysCompleted: number;
  daysClockedOutPending: number;
  totalWorkedMinutes: number;
  averageWorkedMinutes: number | null;
  longestDayMinutes: number | null;
  shortestDayMinutes: number | null;
}

export interface AttendanceMonth {
  month: string;              // YYYY-MM
  timezone: string;
  from: string;               // YYYY-MM-DD
  to: string;                 // YYYY-MM-DD
  daysInMonth: number;
  count: number;
  summary: AttendanceSummary;
  records: Attendance[];
}

export interface AttendanceEditHistory {
  edits: AttendanceEdit[];    // oldest first
}
```
