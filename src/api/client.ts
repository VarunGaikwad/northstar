import {
  RefreshConfigurationError,
  RefreshRejectedError,
  TOKEN_KEY,
  USER_KEY,
  getAuthState,
  hasUsableAccessToken,
  refreshSession,
} from "../auth/session";
import { API_BASE } from "./config";
import type { ApiError, ApiMessage, ApiSuccess } from "./types";

interface RequestOptions {
  authenticated?: boolean;
  allowRefresh?: boolean;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  alreadyRetried = false,
): Promise<T> {
  const authenticated = options.authenticated !== false;
  const allowRefresh = options.allowRefresh !== false;
  let currentAuth = getAuthState();
  const requestUserId = currentAuth.user?.id ?? null;

  if (
    authenticated &&
    allowRefresh &&
    isVisible() &&
    currentAuth.accessToken &&
    !currentAuth.isLegacy &&
    !hasUsableAccessToken()
  ) {
    try {
      await refreshSession(currentAuth.accessToken);
      currentAuth = getAuthState();
      if ((currentAuth.user?.id ?? null) !== requestUserId) {
        throw new HttpError("Authentication changed during the request", 401);
      }
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        throw new HttpError(error.message, 401);
      }
      if (error instanceof RefreshConfigurationError) {
        throw new HttpError(error.message, 403);
      }
      throw error;
    }
  }

  const headers: Record<string, string> = {};
  const configuredHeaders = new Headers(options.headers);
  configuredHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  if (body !== undefined && !configuredHeaders.has("Content-Type")) {
    headers["Content-Type"] = "application/json";
  }
  const requestAccessToken = currentAuth.accessToken;
  if (authenticated && requestAccessToken) {
    headers.Authorization = `Bearer ${requestAccessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: options.credentials,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options.signal,
  });

  if (
    response.status === 401 &&
    authenticated &&
    allowRefresh &&
    !alreadyRetried &&
    isVisible()
  ) {
    try {
      if ((getAuthState().user?.id ?? null) !== requestUserId) {
        throw new HttpError("Authentication changed during the request", 401);
      }
      await refreshSession(requestAccessToken);
      if ((getAuthState().user?.id ?? null) !== requestUserId) {
        throw new HttpError("Authentication changed during the request", 401);
      }
      return request<T>(method, path, body, options, true);
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        throw new HttpError(error.message, 401);
      }
      if (error instanceof RefreshConfigurationError) {
        throw new HttpError(error.message, 403);
      }
      throw error;
    }
  }

  const data = (await response.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiMessage
    | ApiError
    | null;

  if (!response.ok || !data?.success) {
    const message = data && "error" in data ? data.error : `HTTP ${response.status}`;
    throw new HttpError(message, response.status);
  }

  return "data" in data ? data.data : (data as T);
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function apiPublicGet<T>(path: string): Promise<T> {
  return request<T>("GET", path, undefined, {
    authenticated: false,
    allowRefresh: false,
  });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PATCH", path, body, options);
}

export function apiPut<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PUT", path, body, options);
}

export function apiDelete<T>(
  path: string,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("DELETE", path, undefined, options);
}

export function apiMessage(
  path: string,
  method: "DELETE" | "POST" = "DELETE",
  options?: RequestOptions,
): Promise<ApiMessage> {
  return request<ApiMessage>(method, path, undefined, options);
}

export { HttpError, TOKEN_KEY, USER_KEY };
