import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAuthData, clearAuthState } from "../../auth/session";
import type {
  AuthResponse,
  Note,
  NotePage,
  NoteUploadIntent,
  User,
} from "../types";
import { queryClient } from "../queryClient";
import { cacheNote, notesApi, notesKeys, removeCachedNote } from "./notes";

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

const note: Note = {
  id: "note-one",
  title: "Draft",
  content: "Body",
  color: "DEFAULT",
  isPinned: false,
  archivedAt: null,
  trashedAt: null,
  version: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  images: [],
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
  queryClient.clear();
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notes API", () => {
  it("reads the API notes collection and updates and removes cached list entries", async () => {
    applyAuthData(authData("token"), false);
    const blankNote = { ...note, title: "", content: "" };
    const otherNote = { ...note, id: "note-two" };
    const page = { notes: [blankNote, otherNote], nextCursor: "next-page" };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: page }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await notesApi.list({ view: "active", limit: 30 });
    expect(result).toEqual(page);
    expect(fetchMock.mock.calls[0][0]).toContain("/notes?view=active&limit=30");
    const key = notesKeys.list(user.id, "active", 30);
    queryClient.setQueryData(key, { pages: [result], pageParams: [undefined] });

    const updated = { ...blankNote, title: "Saved title", version: 5 };
    cacheNote(updated, user.id);
    expect(queryClient.getQueryData<{ pages: NotePage[] }>(key)?.pages).toEqual([
      { ...page, notes: [updated, otherNote] },
    ]);

    removeCachedNote(note.id, user.id);
    expect(queryClient.getQueryData<{ pages: NotePage[] }>(key)?.pages).toEqual([
      { ...page, notes: [otherNote] },
    ]);
    expect(queryClient.getQueryData(notesKeys.detail(user.id, note.id))).toBeUndefined();
  });

  it("preserves X-Note-Version when a versioned request is retried after refresh", async () => {
    applyAuthData(authData("old-token"), false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: "Access token expired" }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: authData("new-token") }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: note }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      notesApi.update("note/one", 3, { title: "Draft" }),
    ).resolves.toEqual(note);

    const firstRequest = fetchMock.mock.calls[0][1] as RequestInit;
    const retriedRequest = fetchMock.mock.calls[2][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toContain("/notes/note%2Fone");
    expect(firstRequest.method).toBe("PATCH");
    expect(firstRequest.credentials).toBe("include");
    expect(new Headers(firstRequest.headers).get("X-Note-Version")).toBe('"3"');
    expect(new Headers(firstRequest.headers).has("If-Match")).toBe(false);
    expect(new Headers(firstRequest.headers).get("Authorization")).toBe(
      "Bearer old-token",
    );
    expect(new Headers(retriedRequest.headers).get("X-Note-Version")).toBe('"3"');
    expect(new Headers(retriedRequest.headers).has("If-Match")).toBe(false);
    expect(new Headers(retriedRequest.headers).get("Authorization")).toBe(
      "Bearer new-token",
    );
  });

  it("uses typed PUT and data-returning DELETE requests", async () => {
    applyAuthData(authData("token"), false);
    const reordered = { ...note, version: 5 };
    const withoutImage = { ...note, version: 6 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: reordered }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: withoutImage }));
    vi.stubGlobal("fetch", fetchMock);

    await notesApi.reorderImages("note-one", ["image-two", "image-one"], 4);
    await notesApi.deleteImage("note-one", "image-one", 5);

    const putRequest = fetchMock.mock.calls[0][1] as RequestInit;
    const deleteRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(putRequest.method).toBe("PUT");
    expect(putRequest.body).toBe(
      JSON.stringify({ imageIds: ["image-two", "image-one"] }),
    );
    expect(new Headers(putRequest.headers).get("X-Note-Version")).toBe('"4"');
    expect(deleteRequest.method).toBe("DELETE");
    expect(new Headers(deleteRequest.headers).get("X-Note-Version")).toBe('"5"');
  });

  it("uploads signed image bytes without Northstar credentials", async () => {
    const intent: NoteUploadIntent = {
      imageId: "image-one",
      uploadUrl: "https://storage.example.test/signed-upload",
      uploadExpiresAt: "2099-01-01T00:00:00.000Z",
      method: "PUT",
      headers: { "Content-Type": "image/png" },
    };
    const file = new Blob(["image-bytes"], { type: "image/png" }) as File;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await notesApi.uploadImageBytes(intent, file);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(fetchMock.mock.calls[0][0]).toBe(intent.uploadUrl);
    expect(request.method).toBe("PUT");
    expect(request.credentials).toBe("omit");
    expect(request.body).toBe(file);
    expect(headers.get("Content-Type")).toBe("image/png");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("apikey")).toBeNull();
    expect(headers.get("x-upsert")).toBeNull();
  });

  it("does not write a late response into a different user's cache", () => {
    applyAuthData(authData("user-one-token"), false);
    cacheNote(note, user.id);
    expect(queryClient.getQueryData(notesKeys.detail(user.id, note.id))).toEqual(
      note,
    );

    const secondUser = { ...user, id: "user-two", email: "two@example.com" };
    applyAuthData(
      { ...authData("user-two-token"), user: secondUser },
      false,
    );
    cacheNote({ ...note, title: "Late private response" }, user.id);

    expect(
      queryClient.getQueryData(notesKeys.detail(secondUser.id, note.id)),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData<Note>(notesKeys.detail(user.id, note.id))?.title,
    ).toBe("Draft");
  });
});
