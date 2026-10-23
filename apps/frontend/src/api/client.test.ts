import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAuthData, clearAuthState, getAuthState } from "../auth/session";
import type { AuthResponse, User } from "./types";
import { apiGet, apiPost, apiPublicGet } from "./client";

const user: User = {
  id: "user-one",
  email: "user@example.com",
  firstName: null,
  lastName: null,
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
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authenticated API requests", () => {
  it("refreshes an expired access token before requesting data without disconnecting", async () => {
    applyAuthData(
      {
        ...authData("expired-token"),
        accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      false,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: authData("new-token") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: [{ id: "folder-one" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ id: string }[]>("/folders")).resolves.toEqual([
      { id: "folder-one" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/refresh");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer new-token" },
    });
    expect(getAuthState().user).toEqual(user);
    expect(getAuthState().accessToken).toBe("new-token");
  });

  it("refreshes on 401 and retries once with the rotated token", async () => {
    applyAuthData(authData("old-token"), false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: "Access token expired" }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: authData("new-token") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: [{ id: "folder-one" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ id: string }[]>("/folders")).resolves.toEqual([
      { id: "folder-one" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer old-token" },
    });
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/refresh");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      headers: { Authorization: "Bearer new-token" },
    });
  });

  it("does not enter another refresh loop when the retried request returns 401", async () => {
    applyAuthData(authData("old-token"), false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: "Access token expired" }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: authData("new-token") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: "Unauthorized" }, 401),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/folders")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAuthState().accessToken).toBe("new-token");
  });

  it("does not retry a request under a different user's session", async () => {
    applyAuthData(authData("user-one-token"), false);
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = apiPost("/notes", { title: "Private draft" });
    applyAuthData(
      {
        ...authData("user-two-token"),
        user: { ...user, id: "user-two", email: "two@example.com" },
      },
      false,
    );
    resolveRequest(
      jsonResponse({ success: false, error: "Access token expired" }, 401),
    );

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never refreshes a public request", async () => {
    applyAuthData(authData("old-token"), false);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: "Unauthorized" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiPublicGet("/weather")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: {} });
  });
});
