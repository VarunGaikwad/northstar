# Backend API Integration Plan — Northstar Frontend

Integrate the React 19 + TypeScript + Vite dashboard with the Northstar JWT REST API
described in `ENDPOINTS.md`. Replace all dummy / localStorage data with live API calls,
gate the whole app behind login, and add a new Attendance module.

## Decisions (confirmed)

- **Auth gating**: login required for the whole app. Unauthenticated users see a
  login/register screen; nothing renders until a token exists. Weather & LRT are
  technically public endpoints but still load only after login.
- **Data fetching**: TanStack Query (`@tanstack/react-query`). It gives us caching,
  background refetch, and mutation invalidation for the many CRUD endpoints
  (folders, favlinks, attendance) with minimal bespoke code.
- **Attendance**: included as a later phase (Phase 5) of this same plan.
- **No new client libs**: native `fetch` via a thin typed wrapper. No axios, no react-router
  (auth uses a simple state-based gate; the dashboard remains a single page).

## Current state (what changes)

- State lives in a single `useLocalStorage("dashboard.state.v1", DEFAULT_STATE)` blob.
- `Folder`/`Link`/`Weather` are dummy objects in `src/data/*.ts`.
- LRT uses `generateDummyTimetable()` and hardcoded `STATIONS` in `src/data/lrtData.ts`.
- No auth, no API client, no router, no `QueryClient`.
- TS config: strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals/Parameters`.

The backend has **no CORS**, so all API calls go through a Vite dev-server proxy on `/api`
(production would put both behind one origin via reverse proxy). Tokens are JWT bearer,
7-day lifetime, no refresh — UI must catch 401 and redirect to login.

## Backend gaps to design around (from ENDPOINTS.md)

- No refresh-token endpoint → catch 401 → clear token → go to login.
- No forecast endpoint → the Weather widget's 4-day forecast must be dropped or kept as
  a UI placeholder (no backend source). Plan: render only current conditions; remove the
  `forecast` field and its UI row.
- LRT `/search` returns trips already filtered to trains stopping at both endpoints,
  ordered by departure, with `durationMins` and next-day handling done server-side. The
  client stops computing `MIN_PER_STOP` travel time and just displays what comes back.
- LRT times are `"H:MM"` 24h with the leading zero **omitted** (e.g. `"5:41"`); preserve
  when displaying, parse to minutes when sorting/filtering "upcoming".

---

## Phase 0 — Foundation (no UI changes yet)

Goal: every later phase builds on these primitives. None of the existing widgets are
touched here, so the app keeps working with dummy data while the foundation lands.

### 0.1 Dependencies
- Add `@tanstack/react-query` (runtime) to `package.json`.
- No router, no axios, no form libs.

### 0.2 Environment + Vite proxy
- Create `.env.example` (committed) documenting:
  - `VITE_API_BASE` — optional absolute base, defaults to `/api` (uses the dev proxy).
  - `VITE_DEFAULT_TZ` — default IANA timezone for attendance, e.g. `Asia/Tokyo`.
- Update `vite.config.ts`: add `server.proxy['/api'] = { target: 'http://localhost:3000', changeOrigin: true }`
  so `/api/*` requests are forwarded to the backend and CORS is sidestepped in dev.
- Add `.env` to `.gitignore` (already ignored). Document a `VITE_API_BASE=http://localhost:3000/api`
  override for anyone not using the proxy.

### 0.3 API client + types (`src/api/`)
New directory `src/api/` containing:

- `src/api/types.ts` — copy the paste-ready TypeScript DTOs from `ENDPOINTS.md` §
  "TypeScript Type Definitions" (User, AuthResponse, Folder, FavLink, WeatherResponse,
  LRT types, Attendance types, `ApiSuccess<T>`, `ApiMessage`, `ApiError`). These are the
  single source of truth on the wire shapes and supersede the hand-rolled
  `src/types.ts` / `src/types/lrt.ts` shapes (see Phase 1 migration notes).
- `src/api/client.ts` — the typed `fetch` wrapper:
  - Reads `accessToken` from localStorage under key `auth.token` (raw string, not JSON).
  - Base path from `import.meta.env.VITE_API_BASE ?? "/api"`.
  - Always sends `Content-Type: application/json` and `Authorization: Bearer <token>`
    when a token exists.
  - Parses JSON; on `!res.ok || !body?.success` throws `Error(body?.error ?? "HTTP <status>")`.
  - Returns `body.data` for data endpoints, or throws for message endpoints handled by callers.
  - Exposes a 401 interceptor: on `401` it clears `auth.token` + `auth.user` and dispatches
    a `window` `"auth:expired"` event so the `AuthProvider` can flip to the login screen
    without the call site needing to know about auth.
  - Export both `apiGet / apiPost / apiPatch` (data-returning) and `apiMessage`
    (for delete/reset endpoints that return `{ success, message }`).

- `src/api/endpoints/` — one file per resource, each exporting query/mutation hooks.
  Naming convention mirrors ENDPOINTS.md. Each file owns its `queryKey` namespace:
  - `auth.ts`     — `useLogin`, `useRegister`, `useForgotPassword`, `useResetPassword`, `useMe`.
  - `folders.ts`  — `useFolders`, `useFolder`, `useCreateFolder`, `useUpdateFolder`,
    `useDeleteFolder` (invalidates `["folders"]`).
  - `favlinks.ts` — `useFavLinks(folderId?)`, `useFavLink`, `useCreateFavLink`,
    `useUpdateFavLink`, `useDeleteFavLink` (invalidates `["favlinks"]`).
  - `weather.ts`  — `useWeather` (query; no auth needed but still gated by login flow).
  - `lrt.ts`      — `useLrtStations`, `useLrtSearch({from,to,date})`.
  - `attendance.ts` — `useClockIn`, `useClockOut`, `useTodayAttendance`, `useMonthAttendance`,
    `useRangeAttendance`, `useCorrectAttendance`, `useAttendanceHistory`.

  All hooks use `@tanstack/react-query`'s `useQuery` / `useMutation`. Mutations call
  `queryClient.invalidateQueries({ queryKey: [...] })` on success so lists refresh.

### 0.4 Auth context + QueryClient provider (`src/`)
- `src/auth/AuthContext.tsx` — `AuthProvider` exposing:
  - `user: User | null`, `token: string | null`, `isAuthenticated`.
  - `setSession(user, token)` — persists both to localStorage (`auth.token`, `auth.user`
    JSON) and updates state.
  - `logout()` — clears storage and state.
  - Listens for the `"auth:expired"` event from the client and calls `logout()`.
- `src/main.tsx` — wrap `<App/>` in `<QueryClientProvider client={queryClient}>`
  and `<AuthProvider>`. The `QueryClient` default config: `staleTime: 30s`,
  `refetchOnWindowFocus: true`, `retry: 1` (don't retry 401s — the client throws and the
  auth listener fires). Pass `retry: (count, err) => err.status === 401 ? false : count < 1`.

### 0.5 Verification for Phase 0
- `npm run lint` (ESLint) and `npm run build` (`tsc -b && vite build`) must pass.
- No runtime test exists; manual smoke: dev server starts, proxy logs in dev console
  only if backend is up (graceful if down).

---

## Phase 1 — Auth screen + public-resource migration

Goal: ship the login wall and convert the two passive widgets (weather, LRT) to live data.
This is the smallest user-visible change and proves the whole client/proxy/auth stack.

### 1.1 Login/Register screen (`src/auth/AuthScreen.tsx`)
- New component shown by `App.tsx` when `!isAuthenticated`.
- Tabbed form: **Login** (email, password) | **Register** (email, password, firstName,
  lastName) with the ENDPOINTS.md password rules shown as helper text.
- Calls `useLogin` / `useRegister`; on success calls `setSession(user, accessToken)`.
- Surfaces `error.message` from the thrown `Error` as a form-level error (the backend's
  `error` strings are safe to show: "Invalid email or password", "An account with this
  email already exists", etc.).
- "Forgot password?" link opens a small inline form → `useForgotPassword` (always returns
  200, so just show the canned confirmation message).
- Reset-password flow: a lightweight route-less state `"reset"` mode triggered by a query
  param `?token=...` in the URL (read via `window.location.search`); user pastes new
  password, `useResetPassword` runs, on success show "log in with new password" and flip
  back to the Login tab. (No router; this is the only URL-driven state.)

### 1.2 App shell gate (`src/App.tsx`)
- Replace the single-component return with:
  ```tsx
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Dashboard/> : <AuthScreen/>;
  ```
- Move all the existing dashboard JSX into a new `src/Dashboard.tsx` so `App.tsx` is purely
  the auth gate + providers. `Dashboard.tsx` holds the existing widgets and (later) live
  data hooks.

### 1.3 Weather widget → live (`src/components/WeatherWidget.tsx`)
- Swap the `Weather` prop for `useWeather().data`; render loading / error / data states.
- Map `WeatherResponse` → existing display fields:
  - `city` ← `data.location.city` (drop region/country; show under temp).
  - `temp` ← `data.weather.temperature`, `condition` ← `data.weather.condition`,
    `humidity` ← `data.weather.humidity`, `wind` ← `data.weather.windSpeed`.
  - Replace the emoji-icon system with a small `wmoToEmoji(conditionCode)` helper mapping
    the WMO codes (clear=☀️, partly cloudy=⛅, fog=🌫️, rain=🌧️, snow=❄️, etc.).
- **Drop the forecast row** entirely — no backend endpoint provides it. Remove the
  `forecast` field from `Weather` type usage in this widget. (Old dummy `ForecastDay`
  type can be deleted in Phase 2 cleanup.)
- Update the "Dummy Data" badge to remove the word "Dummy" once data is live (or show
  "Live" / nothing).
- `useWeather` should refetch every 10 min (`refetchInterval: 600_000`) and on focus.

### 1.4 LRT widget → live (`src/components/LrtWidget.tsx`, `src/data/lrtData.ts`)
- Replace the hardcoded `STATIONS` array with `useLrtStations().data.stations`. Station
  shape now includes `name` (Japanese), `nameEn`, `nameRomaji` from the API; keep
  `<select>` showing `nameEn`.
- Replace `generateDummyTimetable(...)` + `MIN_PER_STOP` math with `useLrtSearch({from,
  to})`. The backend already:
  - infers direction from station codes,
  - filters to trains stopping at both,
  - orders by departure (next-day sorted last),
  - returns `from.time` (departure), `to.time` (arrival), `durationMins`, `isNextDay`.
- The `upcoming` filter (trains after wall-clock `now`) stays client-side: parse each
  trip's `from.time` ("H:MM") to minutes-of-day, add `1440` when `from.isNextDay`, keep
  those `>= nowMinutes()`, slice to `MAX_UPCOMING`. The 30s `setInterval` ticking `now`
  stays as-is.
- Direction banner + train-type badge reuse the existing props as-is.
- Remove or comment out `generateDummyTimetable` / `formatTime` in `lrtData.ts` once
  unused (delete in Phase 2 cleanup).
- Loading/error states: spinner while `useLrtStations`/`useLrtSearch` resolve; show the
  backend error string if search fails (e.g. "Unknown station").
- `useLrtSearch` should refetch every 60s while the widget is visible.

### 1.5 Type cleanup
- Delete `src/types/lrt.ts` (superseded by `src/api/types.ts`).
- Update `src/types.ts`: remove `ForecastDay`, simplify `Weather` to match the rendered
  subset (or delete `Weather` and use `WeatherResponse` directly from `src/api/types.ts`).
- The dashboard's `Folder`/`Link` types still come from `src/types.ts` for now — they
  migrate in Phase 2 when folders go live (their API shapes differ: `Folder` has
  `parentId` and no nested `links`; `FavLink` replaces `Link`).

### 1.6 Verification for Phase 1
- `npm run lint`, `npm run build`.
- Manual: with backend up, register → dashboard loads → weather + LRT populate from API.
- Manual: stop backend → weather/LRT show error state, not a crash.
- Manual: let the token expire (set `JWT_EXPIRES_IN` short for testing) → first 401
  returns the user to the login screen.

---

## Phase 2 — Folders & FavLinks go live

Goal: replace the localStorage-backed Quick Access panel with server data. This is the
most invasive change to existing user flows (create/rename/delete folder, add/edit/delete
link).

### 2.1 Data model migration
The backend models differ from the current frontend `Folder`/`Link`:
- **Folder** has `id`, `name`, `parentId` (nullable), `createdAt`, `updatedAt`. No nested
  `links` array — links are separate `FavLink` rows filtered by `folderId`.
- **FavLink** replaces `Link`: `id`, `title` (was `name`), `url`, `folderId`, timestamps.

The current UI shows a flat folder list (no nesting) and links grouped by active folder,
so `parentId` can be ignored for now (folders render flat). Plan:
- `src/types.ts`: replace `Folder`/`Link` with the API types from `src/api/types.ts`.
  Keep a minimal display alias if needed, but prefer the raw API type throughout.
- All `state.folders`/`state.weather` localStorage plumbing in `App.tsx` is removed
  (weather already moved in Phase 1; folders move here).

### 2.2 QuickAccess / FolderChips / LinkCard rewrite
- `QuickAccess.tsx`: take `folders`, `activeFolderId` from `useFolders()`; `links` for the
  active folder from `useFavLinks(activeFolderId)`. Keep the existing prop-driven callback
  signatures but back them with mutations:
  - Add folder     → `useCreateFolder` (sends `{ name }`; `parentId` omitted = root).
  - Rename folder   → `useUpdateFolder` (sends `{ name }`).
  - Delete folder   → `useDeleteFolder` (confirm dialog intact; on success invalidates
    both folders and favlinks).
  - Add/edit link  → `useCreateFavLink` / `useUpdateFavLink` with `folderId`.
  - Delete link    → `useDeleteFavLink`.
- Optimistic UI: for quick deletes/renames, use `useMutation`'s `onMutate` to update the
  query cache then let invalidation reconcile. Optional; start non-optimistic for safety.
- `LinkCard.tsx`: read `link.title` instead of `link.name`; `prettyUrl(link.url)` unchanged.
- `FolderFormModal.tsx` / `LinkFormModal.tsx`: no API change — they still call `onSave`.
  `LinkFormModal`'s "Name" field maps to `title` in the save handler in `QuickAccess`/
  `Dashboard`. Keep the "https://" normalization for bare domains.

### 2.3 Loading / empty / error states
- `useFolders` loading → render folder chips skeleton; empty → "No folders yet" (existing
  message) with the **+ Folder** button still visible.
- `useFavLinks(activeFolderId)` loading → grid skeleton; empty → "No links yet" + the
  dashed **+ Add link** card.
- Errors: a small toast/banner at the top of the QuickAccess panel using the thrown error
  message. Mutations show inline form errors (already handled by surfacing `error.message`).

### 2.4 Active-folder persistence
- `activeFolderId` currently lives in `dashboard.state.v1`. Move it to its own
  `useLocalStorage("dashboard.activeFolderId", null)` so it survives without the rest of
  the legacy blob. After load, if the persisted id isn't in the fetched folder list,
  fall back to `folders[0]?.id ?? null`.

### 2.5 Cleanup
- Delete `src/data/defaultData.ts` (no longer seeded from anywhere) and the
  `STORAGE_KEY` / `DashboardState` usage in `App.tsx`.
- Delete the now-unused `useLocalStorage` import for dashboard state (the hook itself
  stays — used by LRT `from`/`to`, search engine, and active folder).

### 2.6 Verification for Phase 2
- `npm run lint`, `npm run build`.
- Manual CRUD against the running backend: create folder → add links → rename → move link
  (if move UI added — not in scope; can patch `folderId` later) → delete link → delete
  folder → confirm list refreshes each time without manual reload.
- Manual: log out via a new header logout button (add in Phase 2 as part of `Header` —
  see below) → folders/links clear; logging back in shows the same server data.

### 2.7 Header logout
- `Header.tsx`: add a logout button (top-right) calling `logout()` from `useAuth()`.
  Also replace the dummy `user` string with `user.firstName ?? user.email` from `useMe()`
  / the cached auth user.

---

## Phase 3 — Polish & robustness

Goal: harden the integration so a flaky/expired session degrades gracefully.

### 3.1 Centralized error boundary
- `src/components/ErrorBoundary.tsx` — catches render errors from widgets, shows a
  non-crashing "Something went wrong — reload" card per widget. Wrap the three widgets
  in `Dashboard.tsx`.

### 3.2 Auth expiry UX
- On `"auth:expired"`: short toast "Your session expired, please log in again." before
  flipping to `AuthScreen`. The `AuthContext` already clears state; add the toast.

### 3.3 Offline / network-down
- TanStack Query's `isPaused` (network offline) → show a subtle "Offline — showing cached
  data" banner. Queries keep serving stale cache.

### 3.4 Token storage note
- Document in `README.md` (or a short `src/auth/README.md`) that the token lives in
  `localStorage` under `auth.token` and is cleared on logout/401. (Vulnerable to XSS, but
  this matches the ENDPOINTS.md "suggested auth flow", which uses localStorage.)

### 3.5 Verification for Phase 3
- `npm run lint`, `npm run build`.
- Manual: kill backend mid-session → offline banner, cached last-known weather/LRT/
  folders remain visible; restart backend → refetch reconciles.
- Manual: corrupt the stored token → first protected request 401 → toast + back to login.

---

## Phase 4 — (reserved)

Phase 4 is left intentionally empty as a buffer for issues found in Phases 1–3
(refresh-interval tuning, optimistic-UI polish, accessibility passes on the new
loading/empty/error states). Do not start new feature work here.

---

## Phase 5 — Attendance module (new widget)

Goal: build the attendance UI from scratch now that auth, the API client, and TanStack
Query are all proven by the live folders/weather/LRT. Attendance is the last module
because it has zero existing UI and is the most complex (clock-in/out, monthly summary,
correction history, timezone handling).

### 5.1 New widget: `AttendancePanel.tsx`
Render as a fourth panel (the layout's grid currently is
`lg:grid-cols-[1.8fr_1fr_1fr]`; extend to accommodate attendance — e.g. a second row or
a 4-col variant on XL screens). Keep the existing three widgets intact.

The panel has three views, switched by tabs:
1. **Today** — clock-in/out status + actions.
2. **Month** — calendar-ish list of the current month's records + summary stats.
3. **History** — for the selected day's record, the full correction audit trail.

### 5.2 Today view
- `useTodayAttendance({ tz })` → `data.attendance` (may be `null`).
- States:
  - `null` and not clocked in → show **Clock In** button → `useClockIn({ tz })`.
  - `checkInAt` set, `checkOutAt` null → show check-in time (`checkInLocal`), **Clock
    Out** button → `useClockOut({ tz })`.
  - both set → show `workedMinutes` (format as `Hh Mm`), in/out local times, and an
    **Edit** button opening a modal.
- Default `tz` from `import.meta.env.VITE_DEFAULT_TZ ?? "UTC"`. Show the timezone label.
- Handle 409 ("Already clocked in today — use the correct endpoint to fix") by pointing the
  user to the Edit modal for that day's record (fetch by date if only the status is known).

### 5.3 Edit (correction) modal
- Reuse `Modal.tsx`. Fields: `checkIn` ("HH:MM"), `checkOut` ("HH:MM"), `reason` (text,
  optional, max 500). At least one of checkIn/checkOut required.
- `useCorrectAttendance({ id, checkIn, checkOut, reason })`. On success, invalidate
  `["attendance","today"]`, `["attendance","month"]`, and the record's history.
- Surface 400 ("checkOut is before checkIn") as a field-level error.

### 5.4 Month view
- `useMonthAttendance({ month, tz })` → `data.records` (sparse — only days with records)
  plus `data.summary` (`daysPresent`, `daysCompleted`, `totalWorkedMinutes`,
  `averageWorkedMinutes`, longest/shortest day).
- Render a compact list grouped by date; click a day → switches to a per-record detail
  (the History view) using `useAttendanceHistory({ id })`.
- Summary stats shown as small stat chips (reuse the Weather humidity/wind chip styling).

### 5.5 History view
- `useAttendanceHistory({ id })` → `data.edits` (oldest first). Render as a timeline:
  each row shows `field` (CHECK_IN/CHECK_OUT), `oldValueLocal` → `newValueLocal`, the
  `reason`, and `editedAt`.
- Empty state: "No corrections yet."

### 5.6 TS shapes
- All attendance types come from `src/api/types.ts` (added in Phase 0.3):
  `Attendance`, `AttendanceEdit`, `AttendanceDay`, `AttendanceMonth`, `AttendanceSummary`,
  `AttendanceField`.

### 5.7 Verification for Phase 5
- `npm run lint`, `npm run build`.
- Manual end-to-end: clock in → clock out → see `workedMinutes`; edit both times with a
  reason → history view shows the correction; switch month → summary recalculates.
- Manual: clock in twice → 409 surfaces correctly; clock out without clock-in → 404
  surfaces correctly; bad timezone (`?tz=Not/A/Zone`) → 400 surfaces correctly.

---

## Cross-cutting conventions

- **Wire shapes**: import everything from `src/api/types.ts`; never redeclare DTOs.
- **`"H:MM"` parsing**: a shared `parseHMM(s): number` (minutes-of-day) and `formatHMMDisplay`
  helper in `src/api/lrtToMinutes.ts` (or similar) used by LRT and Attendance.
- **Error messages**: the backend's `error` strings are user-safe; surface them directly
  via the thrown `Error.message`. No translation layer in this phase.
- **Lint/typecheck**: run `npm run lint` and `npm run build` after every phase. Type errors
  almost always indicate a wire-shape mismatch — fix at the type, not the call site.
- **No comments**: per repo style, do not add code comments unless requested.
- **No commits**: only commit when the user explicitly asks.

## File map (new / changed)

New:
- `src/api/types.ts`, `src/api/client.ts`
- `src/api/endpoints/{auth,folders,favlinks,weather,lrt,attendance}.ts`
- `src/auth/AuthContext.tsx`, `src/auth/AuthScreen.tsx`
- `src/Dashboard.tsx` (extracted from `App.tsx`)
- `src/components/AttendancePanel.tsx` (+ any sub-components)
- `src/components/ErrorBoundary.tsx`
- `.env.example`

Changed:
- `package.json` (add `@tanstack/react-query`)
- `vite.config.ts` (dev proxy)
- `src/main.tsx` (providers)
- `src/App.tsx` (auth gate only)
- `src/components/{WeatherWidget,LrtWidget,QuickAccess,FolderChips,LinkCard,Header}.tsx`
- `src/components/{FolderFormModal,LinkFormModal}.tsx` (minor — title/name mapping)
- `src/types.ts` (slim down; re-export from `api/types` if convenient)

Deleted (by end of Phase 2/5):
- `src/data/defaultData.ts`, `src/data/lrtData.ts`
- `src/types/lrt.ts`

## Suggested execution order

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 (buffer) → Phase 5.

Each phase ends with `npm run lint` + `npm run build` green. Phases 1 and 2 should each be
manually smoke-tested against a running backend before moving on.