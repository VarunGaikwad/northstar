# Frontend Auth Migration Guide

This document describes the frontend changes required for the renewable session backend. It applies to the web application and the Manifest V3 Chrome extension. No frontend source exists in this repository, so these changes must be implemented in the relevant client repositories.

## Session Model

The backend now uses:

- A short-lived access JWT, returned in JSON and valid for 15 minutes by default.
- A rotating refresh JWT, stored only in a host-only HttpOnly cookie.
- A 30-day sliding inactivity limit.
- A fixed 180-day absolute session limit.
- Multiple independent sessions per user.

Protected APIs still require:

```http
Authorization: Bearer <accessToken>
```

Frontend code must never read, copy, or store the refresh token. The browser manages it as an HttpOnly cookie.

## Auth Endpoints

| Method | Endpoint | Authentication | Client behavior |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Include credentials; save returned access token in memory |
| `POST` | `/api/auth/login` | None | Include credentials; save returned access token in memory |
| `POST` | `/api/auth/refresh` | Refresh cookie | Include credentials; replace in-memory access token |
| `POST` | `/api/auth/logout` | Refresh cookie if present | Include credentials; always clear local auth state |
| `POST` | `/api/auth/logout-all` | Bearer access token | Include credentials; always clear local auth state |
| `POST` | `/api/auth/forgot-password` | None | Existing behavior |
| `POST` | `/api/auth/reset-password` | None | Existing behavior; all renewable sessions are revoked |

Registration returns `201`. Login, refresh, logout, and logout-all return `200` on success.

## Response Types

Login, registration, and refresh return this data shape:

```ts
export type Role = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionAuthData {
  user: AuthUser;
  accessToken: string;
  accessTokenExpiresAt: string;
  session: {
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export type AuthSuccessResponse = {
  success: true;
  data: SessionAuthData;
};

export type MessageResponse = {
  success: true;
  message: string;
};

export type ErrorResponse = {
  success: false;
  error: string;
};
```

Example:

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
      "isVerified": true,
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
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

## Required Web Changes

### 1. Use credentialed auth requests

Set `credentials: "include"` on register, login, refresh, logout, and logout-all. This is required both to accept `Set-Cookie` and to send the refresh cookie later.

```ts
const API_URL = import.meta.env.VITE_API_URL;

async function login(email: string, password: string): Promise<SessionAuthData> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as AuthSuccessResponse | ErrorResponse;
  if (!response.ok || !body.success) {
    throw new Error(body.success ? `HTTP ${response.status}` : body.error);
  }

  return body.data;
}
```

Cross-origin login may appear successful while renewal fails if `credentials: "include"` is missing.

### 2. Keep access tokens in memory

Do not persist newly issued access tokens in:

- `localStorage`
- `sessionStorage`
- IndexedDB
- A JavaScript-readable cookie

Keep the token and expiry metadata in application memory, such as a framework auth store or module-level state.

```ts
type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  idleExpiresAt: number | null;
  absoluteExpiresAt: number | null;
};

const authState: AuthState = {
  user: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  idleExpiresAt: null,
  absoluteExpiresAt: null,
};

function applyAuthData(data: SessionAuthData): void {
  authState.user = data.user;
  authState.accessToken = data.accessToken;
  authState.accessTokenExpiresAt = Date.parse(data.accessTokenExpiresAt);
  authState.idleExpiresAt = Date.parse(data.session.idleExpiresAt);
  authState.absoluteExpiresAt = Date.parse(data.session.absoluteExpiresAt);
}

function clearAuthState(): void {
  authState.user = null;
  authState.accessToken = null;
  authState.accessTokenExpiresAt = null;
  authState.idleExpiresAt = null;
  authState.absoluteExpiresAt = null;
}
```

Use `accessTokenExpiresAt` from the response instead of decoding the JWT for session logic.

### 3. Add single-flight refresh

Only one refresh request should run at a time within a tab.

```ts
class RefreshRejectedError extends Error {}
class RefreshTemporaryError extends Error {}

let refreshInFlight: Promise<SessionAuthData> | null = null;

export function refreshSession(): Promise<SessionAuthData> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let response: Response;

    try {
      response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      throw new RefreshTemporaryError(
        error instanceof Error ? error.message : "Refresh network failure",
      );
    }

    const body = (await response.json().catch(() => null)) as
      | AuthSuccessResponse
      | ErrorResponse
      | null;

    if (response.status === 401) {
      clearAuthState();
      throw new RefreshRejectedError("Session expired");
    }

    if (!response.ok || !body?.success || !("data" in body)) {
      throw new RefreshTemporaryError(
        body && !body.success ? body.error : `Refresh failed with HTTP ${response.status}`,
      );
    }

    applyAuthData(body.data);
    return body.data;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}
```

Only a refresh response with status `401` is definitive session failure. Network errors, timeouts, malformed gateway responses, and `5xx` responses must not immediately clear auth state or redirect to login.

### 4. Retry protected requests once

For user-facing protected requests:

1. Send the current access token.
2. If the API returns `401`, refresh once.
3. Retry the original request once with the new token.
4. Never enter an unlimited refresh/retry loop.

```ts
type AuthenticatedRequestOptions = RequestInit & {
  allowRefresh?: boolean;
};

export async function authenticatedFetch(
  path: string,
  options: AuthenticatedRequestOptions = {},
  alreadyRetried = false,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (authState.accessToken) {
    headers.set("Authorization", `Bearer ${authState.accessToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const allowRefresh = options.allowRefresh !== false;
  if (response.status !== 401 || alreadyRetried || !allowRefresh) {
    return response;
  }

  await refreshSession();
  return authenticatedFetch(path, options, true);
}
```

Request bodies must be replayable if a request can be retried. JSON strings and `FormData` are normally replayable; one-use streams are not.

### 5. Refresh only for visible use

Allowed refresh triggers:

- Initial application load while visible.
- Returning from hidden to visible when no usable in-memory token exists.
- A user-driven protected request that needs a token.
- A protected request returning `401`, with one retry.

Do not refresh from:

- Hidden-tab polling.
- Background timers intended only to keep the session alive.
- Analytics, prefetch, or unattended background jobs.

```ts
function hasUsableAccessToken(skewMs = 30_000): boolean {
  return Boolean(
    authState.accessToken &&
      authState.accessTokenExpiresAt &&
      authState.accessTokenExpiresAt > Date.now() + skewMs,
  );
}

async function restoreVisibleSession(): Promise<void> {
  if (document.visibilityState !== "visible" || hasUsableAccessToken()) return;

  try {
    await refreshSession();
  } catch (error) {
    if (error instanceof RefreshRejectedError) {
      // Render the signed-out state.
      return;
    }

    // Keep a retryable/offline state for network and 5xx failures.
    throw error;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void restoreVisibleSession();
  }
});
```

### 6. Coordinate browser tabs

The refresh cookie is shared between tabs. Prevent avoidable simultaneous rotations using Web Locks or `BroadcastChannel`.

Recommended behavior:

- Use one refresh at a time per tab.
- Use a named Web Lock such as `northstar-auth-refresh` across tabs.
- Broadcast updated user and access-token state after refresh if the application's security model permits it.
- Broadcast logout so every tab clears in-memory state.
- Keep the server's 10-second previous-generation grace as a final race safeguard, not the primary coordination mechanism.

### 7. Implement logout correctly

Current-session logout does not need a valid access token:

```ts
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAuthState();
  }
}
```

Logout-all requires the current access token:

```ts
export async function logoutAll(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout-all`, {
      method: "POST",
      credentials: "include",
      headers: authState.accessToken
        ? { Authorization: `Bearer ${authState.accessToken}` }
        : {},
    });
  } finally {
    clearAuthState();
  }
}
```

Call logout even when the access token is expired. Always clear local state regardless of the logout response.

## Legacy Token Transition

Previously issued access tokens can remain valid for up to seven days and have no refresh session.

During the migration:

1. Read an already-stored legacy access token into memory when the upgraded client starts.
2. Continue using that legacy token until it fails.
3. On its first protected-request `401`, attempt refresh once.
4. If refresh returns `401`, clear auth and require one interactive login.
5. After successful login or refresh under the renewable flow, remove the legacy token from persistent storage.
6. Never persist a newly issued access token.

Example cleanup after successful renewable authentication:

```ts
applyAuthData(response.data);
localStorage.removeItem("accessToken");
```

Do not repeatedly exchange or recreate legacy tokens. Legacy tokens cannot mint a refresh session by themselves.

## Chrome Extension Changes

### Manifest

Add only the exact API origin to `host_permissions`:

```json
{
  "manifest_version": 3,
  "host_permissions": [
    "https://api.example.com/*"
  ]
}
```

Do not add the `cookies` permission. Credentialed `fetch` sends the HttpOnly refresh cookie without exposing it to extension code.

### Request location

Make credentialed API calls from:

- The extension service worker.
- The popup.
- The side panel.
- Another extension page.

Do not make these calls directly from a content script. Content-script requests remain subject to the page origin, and content scripts must not receive access tokens.

### Token storage

Store the access token in `chrome.storage.session`:

```ts
await chrome.storage.session.set({
  accessToken: data.accessToken,
  accessTokenExpiresAt: data.accessTokenExpiresAt,
  user: data.user,
});
```

Do not use `chrome.storage.local`. Do not send access tokens to content scripts. Expose fixed-purpose service-worker messages instead of an arbitrary URL fetch proxy.

### Refresh triggers

The extension may refresh when:

- The user opens the popup or side panel.
- The user explicitly invokes a feature that needs authentication.
- A user-driven request gets one `401` and needs one retry.

The extension must not refresh from alarms, hidden extension pages, or unattended background jobs. Those jobs may use an access token only while it remains valid.

Extension cookie behavior must be tested against an HTTPS staging or production API. Do not weaken production cookie attributes to make extension-to-localhost testing work.

## CORS And Origin Configuration

The backend accepts only exact configured origins.

Web example:

```env
FRONTEND_URL="https://app.example.com"
```

Extension example:

```env
CHROME_EXTENSION_ORIGINS="chrome-extension://abcdefghijklmnopabcdefghijklmnop"
```

Requirements:

- Do not use `*`.
- Do not include URL paths.
- Register every production web origin explicitly.
- Register the exact production Chrome extension ID.
- Requests with an untrusted browser `Origin` receive `403`.
- Production cookies require HTTPS.

## Error Handling Contract

| Situation | Client action |
|---|---|
| Protected request returns `401` | Refresh once and retry once |
| Refresh returns `401` | Clear auth state and show login |
| Refresh returns `403` | Report an origin/configuration error; do not loop |
| Refresh returns `5xx` | Preserve retryable auth state |
| Refresh has a network failure | Preserve retryable auth state |
| Logout fails | Clear local state anyway |
| Logout-all fails | Clear local state anyway |

The generic refresh authentication error is:

```json
{
  "success": false,
  "error": "Invalid or expired refresh session"
}
```

Do not branch on more specific refresh failure reasons because the backend intentionally does not expose them.

## Frontend Acceptance Checklist

- Login and registration use `credentials: "include"`.
- Refresh and logout use `credentials: "include"`.
- The access token is absent from new `localStorage`, `sessionStorage`, IndexedDB, and readable cookies.
- Protected requests continue sending the bearer token.
- App startup can silently restore a valid renewable session.
- Access-token expiry does not force an interactive login while the refresh session remains valid.
- A protected request is retried at most once.
- Refresh `401` signs the user out.
- Refresh network errors and `5xx` responses do not sign the user out immediately.
- Hidden tabs do not refresh on an interval.
- Concurrent requests share one in-flight refresh.
- Multiple tabs coordinate refresh and logout.
- Current logout leaves another device session active.
- Logout-all prevents future refreshes on every device.
- Password reset requires existing renewable sessions to log in again.
- Legacy users need at most one final interactive login.
- The extension uses `chrome.storage.session`, not `chrome.storage.local`.
- Content scripts never receive access tokens.
- Extension alarms do not refresh expired sessions.
- Production and extension flows are tested over HTTPS.

## Release Order

1. Implement and test the web and extension changes against HTTPS staging.
2. Ensure the backend migration and production environment variables are ready.
3. Deploy the backend after applying the additive session migration.
4. Immediately deploy the coordinated web release.
5. Publish the approved Chrome extension release.
6. Monitor refresh `401`, CORS failures, and missing-cookie reports.

If a rollback is needed, the backend can temporarily restore `JWT_EXPIRES_IN=7d` for newly issued access tokens. Do not remove the `AuthSession` table, rotate secrets, or assume already-issued 15-minute tokens will change.
