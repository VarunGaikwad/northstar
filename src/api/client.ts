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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const requestAccessToken = currentAuth.accessToken;
  if (authenticated && requestAccessToken) {
    headers.Authorization = `Bearer ${requestAccessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: options.credentials,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (
    response.status === 401 &&
    authenticated &&
    allowRefresh &&
    !alreadyRetried &&
    isVisible()
  ) {
    try {
      await refreshSession(requestAccessToken);
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
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function apiMessage(
  path: string,
  method: "DELETE" | "POST" = "DELETE",
): Promise<ApiMessage> {
  return request<ApiMessage>(method, path);
}

export { HttpError, TOKEN_KEY, USER_KEY };
