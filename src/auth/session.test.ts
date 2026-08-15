import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthResponse, User } from "../api/types";
import {
  RefreshRejectedError,
  RefreshTemporaryError,
  TOKEN_KEY,
  USER_KEY,
  applyAuthData,
  clearAuthState,
  getAuthState,
  initializeAuthSession,
  logoutSession,
  refreshSession,
} from "./session";

const localValues = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => localValues.set(key, value),
    removeItem: (key: string) => localValues.delete(key),
  },
  configurable: true,
});

const user: User = {
  id: "user-one",
  email: "user@example.com",
  firstName: "North",
  lastName: "Star",
  role: "USER",
  isVerified: true,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function authData(accessToken: string): AuthResponse {
  return {
    user,
    accessToken,
    accessTokenExpiresAt: "2099-01-01T00:15:00.000Z",
    session: {
      idleExpiresAt: "2099-02-01T00:00:00.000Z",
      absoluteExpiresAt: "2099-07-01T00:00:00.000Z",
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearAuthState(false);
  localValues.clear();
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("renewable auth session", () => {
  it("imports an existing legacy token without moving it to new persistent storage", async () => {
    localValues.set(TOKEN_KEY, "legacy-token");
    localValues.set(USER_KEY, JSON.stringify(user));

    await initializeAuthSession();

    expect(getAuthState()).toMatchObject({
      user,
      accessToken: "legacy-token",
      isLegacy: true,
    });
    expect(localValues.get(TOKEN_KEY)).toBe("legacy-token");
  });

  it("shares one in-flight refresh and applies the rotated access token", async () => {
    applyAuthData(authData("old-token"), false);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: authData("new-token") }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = refreshSession("old-token");
    const second = refreshSession("old-token");

    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(getAuthState().accessToken).toBe("new-token");
  });

  it("preserves local auth state when refresh fails temporarily", async () => {
    applyAuthData(authData("old-token"), false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ success: false, error: "Service unavailable" }, 503),
      ),
    );

    await expect(refreshSession("old-token")).rejects.toBeInstanceOf(
      RefreshTemporaryError,
    );
    expect(getAuthState().accessToken).toBe("old-token");
  });

  it("clears local auth state only when refresh is rejected", async () => {
    applyAuthData(authData("old-token"), false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { success: false, error: "Invalid or expired refresh session" },
          401,
        ),
      ),
    );

    await expect(refreshSession("old-token")).rejects.toBeInstanceOf(
      RefreshRejectedError,
    );
    expect(getAuthState().accessToken).toBeNull();
    expect(getAuthState().user).toBeNull();
  });

  it("writes renewable auth only to extension session storage", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      runtime: { id: "extension-id" },
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({}),
          set,
          remove,
        },
      },
    });

    applyAuthData(authData("session-token"), false);

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0][0]).toEqual({
      "northstar.auth.session": authData("session-token"),
    });
    expect(localValues.has(TOKEN_KEY)).toBe(false);
  });

  it("clears local state even when the logout request fails", async () => {
    applyAuthData(authData("session-token"), false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(logoutSession()).rejects.toThrow("offline");
    expect(getAuthState().accessToken).toBeNull();
  });
});
