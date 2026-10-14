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
- [Weather](#weather)
- [LRT Timetable](#lrt-timetable)
- [Background](#background)
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

⚠️ **No CORS middleware is configured on the backend.** This affects how you call the API:

- If your frontend runs on a **different origin** than the API (e.g. `http://localhost:5173` → `http://localhost:3000`), the browser will block the responses unless backend CORS is added. Three options:
  1. Add `cors` middleware on the backend (recommended for production), or
  2. In dev, set up a **Vite/webpack dev-server proxy** that forwards `/api` to the backend (e.g. Vite `server.proxy['/api'] = { target: 'http://localhost:3000', changeOrigin: true }`) and call the API via the same origin as your frontend, or
  3. Run frontend and backend behind the same origin via a reverse proxy.

The backend's own `FRONTEND_URL` env var (default `http://localhost:5173`) is currently used only for password-reset email links — it does **not** enable CORS.

### Authentication model

The API uses **Bearer JWT** access tokens. There is **no refresh-token endpoint**.

**Obtaining a token** — call `/api/auth/login` (or `/api/auth/register`); the token is returned **only** in the JSON response body (there is no `Set-Cookie` header):

```json
{ "success": true, "data": { "user": { ... }, "accessToken": "eyJ..." } }
```

**Sending a token** — store `accessToken` (e.g. in `localStorage` or a JS-readable cookie) and attach it to every protected request:

```http
Authorization: Bearer <accessToken>
```

**Token lifetime** — **7 days** by default (env `JWT_EXPIRES_IN`). After expiry the token is rejected with `401 "Invalid or expired token"` and the user must **log in again** (no silent refresh). Plan your UI to catch `401` and redirect to the login screen.

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

List endpoints put the array inside `data`; mutation endpoints put the created/updated object inside `data`.

### Conventions the frontend should rely on

- **Timestamps** — all `createdAt`/`updatedAt`/`*At` instants are **UTC ISO 8601** strings (`2026-07-19T10:38:00.000Z`). Display them in the user's timezone on the client. The Attendance module is timezone-aware and also returns `*Local` fields (`"HH:MM"`) already converted to the record's timezone.
- **Dates** — daily keys use `YYYY-MM-DD`.
- **Times** — LRT/Attendance `HH:MM` fields are **24-hour** strings (`"5:41"`, `"19:38"`) — note the leading zero is **omitted** for hours < 10 (e.g. `"5:41"`, not `"05:41"`). Keep this in mind when sorting/parsing.
- **IDs** — opaque strings (Prisma CUIDs like `clx...`). Never assume numeric IDs.
- **Enums (string literals)** — always compare case-sensitively: `role` ∈ `{"USER","ADMIN"}`, attendance `field` ∈ `{"CHECK_IN","CHECK_OUT"}`.
- **Numbers** — weather: temperature `°C`, wind `km/h`, humidity `%`. Attendance: `workedMinutes`/`durationMins`/`stopsBetween` are integers in **minutes**.
- **Validation errors** come back as `400` with a human-readable `error` string safe to surface to users — use it to populate form-field errors.
- **Empty states** — `GET /api/attendance/me` returns `"attendance": null` when no record exists for the day; list endpoints return `"data": []` when empty.

### Suggested auth flow on the client

```
1. POST /api/auth/login                -> store data.accessToken + data.user
2. Attach `Authorization: Bearer <token>` to a shared fetch/axios instance
3. On any 401 response  -> clear token, redirect to /login
4. For workflows: GET /api/users/me to hydrate the session/profile
5. Password reset: POST forgot-password -> (user clicks email link) -> POST reset-password -> re-login
```

### Suggested fetch wrapper

```ts
const API = {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success)
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body.data ?? body;
  }
};
// Usage: const user = await API.request<User>('/users/me');
```

---

## Health & Root

| Method | Path      | Auth | Description                |
| ------ | --------- | ---- | -------------------------- |
| GET    | `/health` | No   | Health check               |
| GET    | `/`       | No   | Hello world (legacy route) |

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

| Method | Path                        | Auth | Description                                              |
| ------ | --------------------------- | ---- | -------------------------------------------------------- |
| POST   | `/api/auth/register`        | No   | Create a new user account                                |
| POST   | `/api/auth/login`           | No   | Authenticate and receive an access token                 |
| POST   | `/api/auth/forgot-password` | No   | Request a password reset (sends email if account exists) |
| POST   | `/api/auth/reset-password`  | No   | Reset password using a token from the reset email        |

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
    "accessToken": "eyJ..."
  }
}
```

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

**Response `200`** — same shape as register (`user` + `accessToken`)

**Error `401`**

```json
{ "success": false, "error": "Invalid email or password" }
```

**Error `403`**

```json
{ "success": false, "error": "Account is deactivated" }
```

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

---

## Users

Prefix: `/api/users`

| Method | Path            | Auth | Description                          |
| ------ | --------------- | ---- | ------------------------------------ |
| GET    | `/api/users`    | No   | List all users (no auth needed)      |
| GET    | `/api/users/me` | Yes  | Get the currently authenticated user |

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

| Method | Path               | Auth | Description                       |
| ------ | ------------------ | ---- | --------------------------------- |
| POST   | `/api/folders`     | Yes  | Create a new folder               |
| GET    | `/api/folders`     | Yes  | List all folders for the user     |
| GET    | `/api/folders/:id` | Yes  | Get a single folder by ID         |
| PATCH  | `/api/folders/:id` | Yes  | Update a folder (name / parentId) |
| DELETE | `/api/folders/:id` | Yes  | Delete a folder                   |

### POST `/api/folders`

**Request body**

```json
{
  "name": "Bookmarks",
  "parentId": "clx..." // optional, for nested folders
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
  "parentId": null // set to null to move to root level
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

| Method | Path                | Auth | Description                               |
| ------ | ------------------- | ---- | ----------------------------------------- |
| POST   | `/api/favlinks`     | Yes  | Create a new favlink                      |
| GET    | `/api/favlinks`     | Yes  | List favlinks (optional `folderId` query) |
| GET    | `/api/favlinks/:id` | Yes  | Get a single favlink by ID                |
| PATCH  | `/api/favlinks/:id` | Yes  | Update a favlink                          |
| DELETE | `/api/favlinks/:id` | Yes  | Delete a favlink                          |

### POST `/api/favlinks`

**Request body**

```json
{
  "title": "GitHub",
  "url": "https://github.com",
  "folderId": "clx..." // optional, omit or leave out for uncategorized
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
| ---------- | ------ | -------- | ------------------------------------------- |
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
  "folderId": null // set to null to remove from folder
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

## Weather

Prefix: `/api/weather`

No authentication required. Works with optional `lat` / `lon` query params for accuracy.

| Method | Path           | Auth | Description                                                                     |
| ------ | -------------- | ---- | ------------------------------------------------------------------------------- |
| GET    | `/api/weather` | No   | Get current weather. No params → IP geolocation. Pass `lat`+`lon` for accuracy. |

### GET `/api/weather`

**Query parameters** (both optional; must be provided together)

| Param | Type   | Required | Description             |
| ----- | ------ | -------- | ----------------------- |
| `lat` | number | No       | Latitude (-90 to 90)    |
| `lon` | number | No       | Longitude (-180 to 180) |

If `lat` and `lon` are omitted, the endpoint geolocates the request IP address via **ip-api.com** (free) to derive an approximate location, then fetches weather for that location.

If `lat` and `lon` are provided, they are used directly (more accurate).

**Response `200`**

```json
{
  "success": true,
  "data": {
    "location": {
      "city": "Mumbai",
      "region": "Maharashtra",
      "country": "India",
      "lat": 19.076,
      "lon": 72.8777,
      "source": "ip"
    },
    "weather": {
      "temperature": 32.5,
      "feelsLike": 35.1,
      "condition": "Partly cloudy",
      "conditionCode": 2,
      "humidity": 65,
      "windSpeed": 12.3,
      "windDirection": 180
    }
  }
}
```

- `location.source` is `"ip"` when geolocated, `"user"` when `lat`/`lon` were provided.
- `weather.conditionCode` is the [WMO weather interpretation code](https://open-meteo.com/en/docs#weathervariables).
- Temperature in **°C**, wind speed in **km/h**, humidity in **%**.

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
| ------ | -------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/lrt/timetable` | No   | Get the full timetable for a day (auto weekday/holiday, optional filter) |
| GET    | `/api/lrt/stations`  | No   | List the 19 stations in inbound order (with English/romaji names)        |
| GET    | `/api/lrt/search`    | No   | Find trains between a **from** and **to** station for a given date       |

### GET `/api/lrt/timetable`

**Query parameters** (all optional)

| Param       | Type   | Required | Description                                                                                   |
| ----------- | ------ | -------- | --------------------------------------------------------------------------------------------- |
| `date`      | string | No       | `YYYY-MM-DD`. Defaults to today (UTC).                                                        |
| `direction` | enum   | No       | `INBOUND` (上り) or `OUTBOUND` (下り). Omit to return both.                                   |
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
              {
                "stopSequence": 0,
                "stationCode": 0,
                "stationName": "芳賀・高根沢工業団地",
                "stationNameEn": "Haga-Takanezawa Industrial Park",
                "arrival": null,
                "departure": null,
                "isNextDay": false,
                "stopType": "NOSERVICE"
              },
              {
                "stopSequence": 13,
                "stationCode": 13,
                "stationName": "平石",
                "stationNameEn": "Hiraishi",
                "arrival": null,
                "departure": "5:41",
                "isNextDay": false,
                "stopType": "STOP"
              },
              {
                "stopSequence": 18,
                "stationCode": 18,
                "stationName": "宇都宮駅東口",
                "stationNameEn": "Utsunomiya Station East Exit",
                "arrival": "5:56",
                "departure": null,
                "isNextDay": false,
                "stopType": "STOP"
              }
            ]
          }
        ]
      },
      { "direction": "OUTBOUND", "tripCount": 81, "trips": ["..."] }
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
{
  "success": false,
  "error": "No LRT timetable data found. Run the seed:lrt script to load the timetable."
}
```

### GET `/api/lrt/stations`

**Response `200`** — 19 stations in inbound order:

```json
{
  "success": true,
  "data": {
    "stations": [
      {
        "code": 0,
        "name": "芳賀・高根沢工業団地",
        "nameEn": "Haga-Takanezawa Industrial Park",
        "nameRomaji": "haga-takanezawa-kogyo-danchi"
      },
      {
        "code": 13,
        "name": "平石",
        "nameEn": "Hiraishi",
        "nameRomaji": "hiraishi"
      },
      {
        "code": 18,
        "name": "宇都宮駅東口",
        "nameEn": "Utsunomiya Station East Exit",
        "nameRomaji": "utsunomiya-eki-higashiguchi"
      }
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

| Param          | Type   | Required | Description                                                                                             |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `date`         | string | No       | `YYYY-MM-DD`. Defaults to today (UTC).                                                                  |
| `from`         | string | **Yes**  | Origin station — a station **code** (`"0"`), Japanese name, English name, or romaji (case-insensitive). |
| `to`           | string | **Yes**  | Destination station — same ref formats as `from`. Must differ from `from`.                              |
| `dayType`      | enum   | No       | `WEEKDAY` or `HOLIDAY`. Overrides auto-detection.                                                       |
| `includeStops` | bool   | No       | Include the full per-station stops array per trip. Default `true`. Set `false` for a lighter payload.   |

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
    "from": {
      "code": 0,
      "name": "芳賀·高根沢工業団地",
      "nameEn": "Haga-Takanezawa Industrial Park",
      "nameRomaji": "haga-takanezawa-kogyo-danchi"
    },
    "to": {
      "code": 18,
      "name": "宇都宮駅東口",
      "nameEn": "Utsunomiya Station East Exit",
      "nameRomaji": "utsunomiya-eki-higashiguchi"
    },
    "direction": "INBOUND",
    "tripCount": 85,
    "trips": [
      {
        "tripIndex": 0,
        "trainType": "LOCAL",
        "direction": "INBOUND",
        "from": {
          "stationCode": 0,
          "stationName": "芳賀·高根沢工業団地",
          "stationNameEn": "Haga-Takanezawa Industrial Park",
          "time": "5:26",
          "isNextDay": false
        },
        "to": {
          "stationCode": 18,
          "stationName": "宇都宮駅東口",
          "stationNameEn": "Utsunomiya Station East Exit",
          "time": "6:10",
          "isNextDay": false
        },
        "durationMins": 44,
        "stopsBetween": 17,
        "stops": [
          /* full per-station stops, same shape as /timetable ("...") */
        ]
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

| Status | Condition                                       |
| ------ | ----------------------------------------------- |
| 400    | `from`/`to` missing, equal, or `date` malformed |
| 404    | `from` or `to` does not match any station       |

```json
{ "success": false, "error": "from and to must be different stations" }
{ "success": false, "error": "Unknown station: \"Tokyo\"" }
```

---

## Background

Prefix: `/api/background`

No authentication required. Returns a curated Unsplash landscape photo, refreshed once per UTC day and cached in memory.

| Method | Path              | Auth | Description                  |
| ------ | ----------------- | ---- | ---------------------------- |
| GET    | `/api/background` | No   | Get a daily background image |

### GET `/api/background`

**Query parameters**

| Param   | Type   | Required | Description                                                                                   |
| ------- | ------ | -------- | --------------------------------------------------------------------------------------------- |
| `query` | string | No       | Search term passed to Unsplash (e.g. `nature`, `city`). Defaults to a random landscape photo. |

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

## Attendance

Prefix: `/api/attendance`

Track check-in / check-out, one of each per user per day. All endpoints require authentication — every record belongs to the authenticated user, and users can only read/correct their own records.

| Method | Path           | Auth | Description                                                |
| ------ | -------------- | ---- | ---------------------------------------------------------- |
| POST   | `/clock-in`    | Yes  | Clock in for today                                         |
| POST   | `/clock-out`   | Yes  | Clock out for today                                        |
| GET    | `/me`          | Yes  | Get my attendance for a day (defaults to today)            |
| GET    | `/me/range`    | Yes  | Get my attendance between two dates (inclusive)            |
| GET    | `/me/month`    | Yes  | Get my attendance for a whole month + summary stats        |
| PATCH  | `/:id`         | Yes  | Correct a record's check-in and/or check-out time          |
| GET    | `/:id/history` | Yes  | View the full correction history (audit trail) of a record |

### How "that day" is determined

Clock-in/out **always apply to the day in the record's timezone** — the server wall-clock instant is classified into a `YYYY-MM-DD` in the supplied timezone (`?tz=` on clock endpoints, default `UTC`). A single check-in + check-out per user per day is enforced (`@@unique([userId, date])`).

All times are stored as UTC `DateTime` and rendered both as ISO 8601 (UTC) and as `HH:MM` in the record's timezone (`checkInLocal` / `checkOutLocal`). `workedMinutes` is computed as `checkOut − checkIn` in absolute UTC — so it stays correct even when check-out lands on the next UTC day (e.g. a late shift in a `+` timezone).

### POST `/api/attendance/clock-in`

**Body** (all optional)

| Field | Type   | Description                                            |
| ----- | ------ | ------------------------------------------------------ |
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

| Status | Condition                                          |
| ------ | -------------------------------------------------- |
| 409    | Already clocked in today (use `PATCH /:id` to fix) |
| 400    | Unknown timezone name                              |

```json
{
  "success": false,
  "error": "Already clocked in on 2026-07-19 (Asia/Tokyo) at 19:38 — use the correct endpoint to fix it"
}
```

### POST `/api/attendance/clock-out`

Same body (`tz`) as clock-in. Sets `checkOutAt` on the existing record for today (in `tz`).

**Response `200`** — same shape as clock-in, with `checkOutAt` / `checkOutLocal` filled and `workedMinutes` computed.

**Errors**

| Status | Condition                                           |
| ------ | --------------------------------------------------- |
| 404    | No clock-in found for today in that timezone        |
| 409    | Already clocked out today (use `PATCH /:id` to fix) |
| 400    | Server clock-out time is before the check-in time   |

### GET `/api/attendance/me`

**Query** (all optional)

| Param  | Type   | Description                                                                                                          |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `date` | string | `YYYY-MM-DD` (in `tz`). Defaults to today in `tz`.                                                                   |
| `tz`   | string | IANA timezone name. Default `UTC`. Affects the date used and the `*Local` display formatting of the returned record. |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "date": "2026-07-19",
    "timezone": "Asia/Tokyo",
    "attendance": {
      /* AttendanceDTO, or null if no record that day */
    }
  }
}
```

### GET `/api/attendance/me/range`

**Query**

| Param  | Type   | Required | Description                                       |
| ------ | ------ | -------- | ------------------------------------------------- |
| `from` | string | Yes      | `YYYY-MM-DD` (inclusive)                          |
| `to`   | string | Yes      | `YYYY-MM-DD` (inclusive, must be `>= from`)       |
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
    "records": [
      /* AttendanceDTO[] ordered by date ascending */
    ]
  }
}
```

### GET `/api/attendance/me/month`

Get your attendance for an entire month in one call, **with a summary** of worked time. This is the convenience endpoint for a monthly attendance view.

**Query** (all optional)

| Param   | Type   | Description                                                                                           |
| ------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `month` | string | `YYYY-MM` (e.g. `2026-07`). Defaults to the current month in `tz`. Must be a valid month (`01`–`12`). |
| `tz`    | string | IANA timezone name. Default `UTC`. Used to determine "current month" and to render `*Local` times.    |

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
      "daysPresent": 1, // records with a check-in
      "daysCompleted": 1, // records with both check-in AND check-out
      "daysClockedOutPending": 0, // clocked in but not out yet
      "totalWorkedMinutes": 510, // sum over completed records
      "averageWorkedMinutes": 510, // per completed day (null if 0)
      "longestDayMinutes": 510,
      "shortestDayMinutes": 510
    },
    "records": [
      /* AttendanceDTO[], ordered by date ascending */
    ]
  }
}
```

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| 400    | `month` is not `YYYY-MM`, month out of range, or unknown `tz` |

```json
{ "success": false, "error": "month must be between 01 and 12" }
{ "success": false, "error": "Unknown timezone: \"Not/A/Zone\"" }
```

### PATCH `/api/attendance/:id`

Correct a record's check-in and/or check-out. Previous values are preserved in the audit history (`AttendanceEdit` rows) — nothing is lost.

**Body** (at least one field required)

| Field      | Type   | Description                                              |
| ---------- | ------ | -------------------------------------------------------- |
| `checkIn`  | string | New check-in time, `HH:MM` in the record's timezone.     |
| `checkOut` | string | New check-out time, `HH:MM` in the record's timezone.    |
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

| Status | Condition                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- |
| 400    | Neither `checkIn` nor `checkOut` provided; bad `HH:MM`; or `checkOut` is before `checkIn` |
| 404    | Record not found (or doesn't belong to the caller)                                        |

### GET `/api/attendance/:id/history`

List the full edit history for one record (oldest first).

**Response `200`**

```json
{
  "success": true,
  "data": {
    "edits": [
      {
        "id": "cle001",
        "field": "CHECK_IN",
        "oldValue": "...",
        "oldValueLocal": "19:38",
        "newValue": "...",
        "newValueLocal": "09:00",
        "reason": "...",
        "editedAt": "...",
        "editedByUserId": "clyyyy"
      }
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

The token is a signed JWT containing:

- `userId` (string)
- `email` (string)
- `role` (string: `"USER"` or `"ADMIN"`)

---

## Error Response Format

All errors follow a consistent shape:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

| Status Code | Meaning                          |
| ----------- | -------------------------------- |
| 400         | Validation error                 |
| 401         | Missing/invalid/expired token    |
| 403         | Account deactivated              |
| 404         | Resource not found (via Prisma)  |
| 409         | Duplicate resource (e.g., email) |
| 500         | Internal server error            |

---

## Summary — All Routes at a Glance

| #   | Method | Path                          | Auth | Description                         |
| --- | ------ | ----------------------------- | ---- | ----------------------------------- |
| 1   | GET    | `/health`                     | —    | Health check                        |
| 2   | GET    | `/`                           | —    | Hello world                         |
| 3   | GET    | `/api/weather`                | —    | Get weather (IP or coords)          |
| 4   | POST   | `/api/auth/register`          | —    | Register                            |
| 5   | POST   | `/api/auth/login`             | —    | Login                               |
| 6   | POST   | `/api/auth/forgot-password`   | —    | Forgot password                     |
| 7   | POST   | `/api/auth/reset-password`    | —    | Reset password                      |
| 8   | GET    | `/api/users`                  | —    | List all users                      |
| 9   | GET    | `/api/users/me`               | Yes  | Get current user                    |
| 10  | POST   | `/api/folders`                | Yes  | Create folder                       |
| 11  | GET    | `/api/folders`                | Yes  | List folders                        |
| 12  | GET    | `/api/folders/:id`            | Yes  | Get folder by ID                    |
| 13  | PATCH  | `/api/folders/:id`            | Yes  | Update folder                       |
| 14  | DELETE | `/api/folders/:id`            | Yes  | Delete folder                       |
| 15  | POST   | `/api/favlinks`               | Yes  | Create favlink                      |
| 16  | GET    | `/api/favlinks`               | Yes  | List favlinks                       |
| 17  | GET    | `/api/favlinks/:id`           | Yes  | Get favlink by ID                   |
| 18  | PATCH  | `/api/favlinks/:id`           | Yes  | Update favlink                      |
| 19  | DELETE | `/api/favlinks/:id`           | Yes  | Delete favlink                      |
| 20  | GET    | `/api/lrt/timetable`          | —    | LRT timetable for a day             |
| 21  | GET    | `/api/lrt/stations`           | —    | LRT station list (19)               |
| 22  | GET    | `/api/lrt/search`             | —    | LRT trains from→to for a date       |
| 23  | GET    | `/api/background`             | —    | Daily background image              |
| 24  | POST   | `/api/attendance/clock-in`    | Yes  | Clock in for today                  |
| 25  | POST   | `/api/attendance/clock-out`   | Yes  | Clock out for today                 |
| 26  | GET    | `/api/attendance/me`          | Yes  | My attendance for a day             |
| 27  | GET    | `/api/attendance/me/range`    | Yes  | My attendance by date range         |
| 28  | GET    | `/api/attendance/me/month`    | Yes  | My attendance for a month + summary |
| 29  | PATCH  | `/api/attendance/:id`         | Yes  | Correct check-in/out time           |
| 30  | GET    | `/api/attendance/:id/history` | Yes  | Attendance correction history       |

**Total: 30 endpoints** (7 public root/weather/lrt/background, 4 auth, 2 users, 5 folders, 5 favlinks, 7 attendance)

---

## TypeScript Type Definitions

Paste-ready types for the frontend. These mirror the backend DTOs (see `src/modules/*/...types.ts`).
Replace the Prisma enum imports with the string-literal unions shown below — these are exactly
the string values the API sends on the wire (stored as UTC ISO / `YYYY-MM-DD` / `"H:MM"`).

```ts
// ── Shared responses ────────────────────────────────────────────────
export type ApiSuccess<T> = { success: true; data: T };
export type ApiMessage = { success: true; message: string };
export type ApiError = { success: false; error: string };

// ── Auth & Users ────────────────────────────────────────────────────
export type Role = "USER" | "ADMIN";

export interface User {
  id: string; // Prisma CUID, e.g. "clx..."
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string; // UTC ISO 8601
}

export interface AuthResponse {
  user: User;
  accessToken: string; // JWT, 7d default lifetime
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

// ── Weather ─────────────────────────────────────────────────────────
export interface WeatherLocation {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  source: "ip" | "user"; // "ip" = geolocated, "user" = lat/lon supplied
}

export interface WeatherConditions {
  temperature: number; // °C
  feelsLike: number; // °C
  condition: string;
  conditionCode: number; // WMO weather interpretation code
  humidity: number; // %
  windSpeed: number; // km/h
  windDirection: number; // degrees
}

export interface WeatherResponse {
  location: WeatherLocation;
  weather: WeatherConditions;
}

// ── Background ──────────────────────────────────────────────────────
export interface PhotographerCredit {
  name: string;
  username: string;
  profileUrl: string;
}

export interface BackgroundImage {
  url: string; // 1920x1080 cropped Unsplash image URL
  alt: string | null; // Photo description
  unsplashUrl: string; // Link to the photo on Unsplash
  photographer: PhotographerCredit;
}

export interface BackgroundResponse {
  image: BackgroundImage;
}

// ── LRT Timetable ──────────────────────────────────────────────────
export type LrtDayType = "WEEKDAY" | "HOLIDAY";
export type LrtDirection = "INBOUND" | "OUTBOUND";
export type LrtTrainType = "LOCAL" | "RAPID";
export type LrtStopType = "STOP" | "PASS" | "NOSERVICE";

export interface Station {
  code: number; // 0..18, inbound order
  name: string; // Japanese
  nameEn: string | null;
  nameRomaji: string | null;
}

export interface Stop {
  stopSequence: number;
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  arrival: string | null; // "H:MM" 24h (leading zero omitted)
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
  date: string; // YYYY-MM-DD
  dayType: LrtDayType;
  isToday: boolean;
  directions: DirectionTimetable[];
}

export interface LrtStationsResponse {
  stations: Station[];
}

// ── LRT Route search ────────────────────────────────────────────────
export interface RouteStop {
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  time: string | null; // departure at origin / arrival at destination
  isNextDay: boolean;
}

export interface RouteTrip {
  tripIndex: number;
  trainType: LrtTrainType;
  direction: LrtDirection;
  from: RouteStop;
  to: RouteStop;
  durationMins: number;
  stopsBetween: number; // intermediate stations, exclusive of endpoints
  stops: Stop[]; // full journey, same shape as /timetable
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
  oldValue: string | null; // UTC ISO
  oldValueLocal: string | null; // "HH:MM" in record tz
  newValue: string | null;
  newValueLocal: string | null;
  reason: string | null;
  editedAt: string; // UTC ISO
  editedByUserId: string;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (record's timezone)
  timezone: string; // IANA name, e.g. "Asia/Tokyo"
  checkInAt: string | null; // UTC ISO
  checkOutAt: string | null;
  checkInLocal: string | null;
  checkOutLocal: string | null;
  workedMinutes: number | null; // null until checked out
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
  records: Attendance[]; // ordered by date ascending
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
  month: string; // YYYY-MM
  timezone: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  daysInMonth: number;
  count: number;
  summary: AttendanceSummary;
  records: Attendance[];
}

export interface AttendanceEditHistory {
  edits: AttendanceEdit[]; // oldest first
}
```
