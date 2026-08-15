import { API_BASE } from "../api/config";
import type { AuthResponse, User } from "../api/types";

export const TOKEN_KEY = "auth.token";
export const USER_KEY = "auth.user";

const EXTENSION_SESSION_KEY = "northstar.auth.session";
const REFRESH_LOCK_NAME = "northstar-auth-refresh";
const AUTH_CHANNEL_NAME = "northstar-auth";

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  idleExpiresAt: number | null;
  absoluteExpiresAt: number | null;
  isLegacy: boolean;
}

interface ChromeSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

type AuthBroadcastMessage =
  | { type: "auth:updated"; data: AuthResponse }
  | { type: "auth:logout" };

const EMPTY_STATE: AuthState = {
  user: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  idleExpiresAt: null,
  absoluteExpiresAt: null,
  isLegacy: false,
};

let authState: AuthState = EMPTY_STATE;
let initializeInFlight: Promise<void> | null = null;
let refreshInFlight: Promise<AuthState> | null = null;
let authChannel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

export class RefreshRejectedError extends Error {}
export class RefreshTemporaryError extends Error {}
export class RefreshConfigurationError extends Error {}

function extensionSessionStorage(): ChromeSessionStorage | null {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: { id?: string };
      storage?: { session?: ChromeSessionStorage };
    };
  }).chrome;

  return chromeApi?.runtime?.id && chromeApi.storage?.session
    ? chromeApi.storage.session
    : null;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthResponse>;
  return Boolean(
    candidate.user &&
      typeof candidate.user.id === "string" &&
      typeof candidate.accessToken === "string" &&
      typeof candidate.accessTokenExpiresAt === "string" &&
      candidate.session &&
      typeof candidate.session.idleExpiresAt === "string" &&
      typeof candidate.session.absoluteExpiresAt === "string",
  );
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function setAuthState(next: AuthState): void {
  authState = next;
  notify();
}

function removeLegacyStorage(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // Authentication still works when persistent browser storage is unavailable.
  }
}

async function persistExtensionSession(data: AuthResponse | null): Promise<void> {
  const storage = extensionSessionStorage();
  if (!storage) return;

  try {
    if (data) {
      await storage.set({ [EXTENSION_SESSION_KEY]: data });
    } else {
      await storage.remove(EXTENSION_SESSION_KEY);
    }
  } catch {
    // Keep the current page's in-memory session if extension storage is unavailable.
  }
}

function ensureAuthChannel(): BroadcastChannel | null {
  if (authChannel || typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return authChannel;
  }

  authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  authChannel.addEventListener("message", (event: MessageEvent<AuthBroadcastMessage>) => {
    if (event.data.type === "auth:updated" && isAuthResponse(event.data.data)) {
      applyAuthData(event.data.data, false);
    } else if (event.data.type === "auth:logout") {
      clearAuthState(false);
    }
  });
  return authChannel;
}

function broadcast(message: AuthBroadcastMessage): void {
  ensureAuthChannel()?.postMessage(message);
}

function readLegacySession(): AuthState | null {
  try {
    const accessToken = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!accessToken || !rawUser) return null;

    const user = JSON.parse(rawUser) as User;
    if (!user || typeof user.id !== "string") return null;

    return {
      ...EMPTY_STATE,
      user,
      accessToken,
      isLegacy: true,
    };
  } catch {
    return null;
  }
}

export function getAuthState(): AuthState {
  return authState;
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasUsableAccessToken(skewMs = 30_000): boolean {
  return Boolean(
    authState.accessToken &&
      (authState.isLegacy ||
        (authState.accessTokenExpiresAt !== null &&
          authState.accessTokenExpiresAt > Date.now() + skewMs)),
  );
}

export function applyAuthData(data: AuthResponse, shouldBroadcast = true): void {
  const next: AuthState = {
    user: data.user,
    accessToken: data.accessToken,
    accessTokenExpiresAt: timestamp(data.accessTokenExpiresAt),
    idleExpiresAt: timestamp(data.session.idleExpiresAt),
    absoluteExpiresAt: timestamp(data.session.absoluteExpiresAt),
    isLegacy: false,
  };

  setAuthState(next);
  removeLegacyStorage();
  void persistExtensionSession(data);
  if (shouldBroadcast) broadcast({ type: "auth:updated", data });
}

export function clearAuthState(shouldBroadcast = true): void {
  setAuthState(EMPTY_STATE);
  removeLegacyStorage();
  void persistExtensionSession(null);
  if (shouldBroadcast) broadcast({ type: "auth:logout" });
}

export function initializeAuthSession(): Promise<void> {
  if (initializeInFlight) return initializeInFlight;

  initializeInFlight = (async () => {
    ensureAuthChannel();
    const storage = extensionSessionStorage();
    if (storage) {
      try {
        const stored = await storage.get(EXTENSION_SESSION_KEY);
        const data = stored[EXTENSION_SESSION_KEY];
        if (isAuthResponse(data)) {
          applyAuthData(data, false);
          return;
        }
      } catch {
        // Fall through to the legacy transition when extension storage fails.
      }
    }

    const legacy = readLegacySession();
    if (legacy) setAuthState(legacy);
  })();

  return initializeInFlight;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function signalExpiredSession(hadLocalAuth: boolean): void {
  clearAuthState();
  if (hadLocalAuth && typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth:expired"));
  }
}

async function performRefresh(rejectedAccessToken?: string | null): Promise<AuthState> {
  if (
    hasUsableAccessToken() &&
    (rejectedAccessToken === undefined || authState.accessToken !== rejectedAccessToken)
  ) {
    return authState;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
  } catch (error) {
    throw new RefreshTemporaryError(
      error instanceof Error ? error.message : "Refresh network failure",
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { success: true; data: AuthResponse }
    | { success: false; error: string }
    | null;

  if (response.status === 401) {
    const hadLocalAuth = Boolean(authState.user || authState.accessToken);
    signalExpiredSession(hadLocalAuth);
    throw new RefreshRejectedError("Session expired");
  }

  if (response.status === 403) {
    const message = body && !body.success ? body.error : "Authentication origin is not allowed";
    throw new RefreshConfigurationError(message);
  }

  if (!response.ok || !body?.success || !isAuthResponse(body.data)) {
    const message = body && !body.success
      ? body.error
      : `Refresh failed with HTTP ${response.status}`;
    throw new RefreshTemporaryError(message);
  }

  applyAuthData(body.data);
  return authState;
}

async function refreshWithCrossTabLock(
  rejectedAccessToken?: string | null,
): Promise<AuthState> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return performRefresh(rejectedAccessToken);
  }

  return navigator.locks.request(REFRESH_LOCK_NAME, () =>
    performRefresh(rejectedAccessToken),
  );
}

export function refreshSession(rejectedAccessToken?: string | null): Promise<AuthState> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = refreshWithCrossTabLock(rejectedAccessToken).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function restoreVisibleSession(): Promise<void> {
  if (!isVisible() || authState.isLegacy || hasUsableAccessToken()) return;
  await refreshSession();
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAuthState();
  }
}

export async function logoutAllSessions(): Promise<void> {
  const accessToken = authState.accessToken;
  try {
    await fetch(`${API_BASE}/auth/logout-all`, {
      method: "POST",
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  } finally {
    clearAuthState();
  }
}
