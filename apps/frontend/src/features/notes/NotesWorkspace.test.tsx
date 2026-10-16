// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { applyAuthData, clearAuthState } from "../../auth/session";
import { queryClient } from "../../api/queryClient";
import { NotesWorkspace } from "./NotesWorkspace";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-one" } }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("renders blank notes from the API notes collection instead of crashing", async () => {
  const user = {
    id: "user-one",
    email: "user@example.com",
    firstName: null,
    lastName: null,
    role: "USER" as const,
    isVerified: true,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  clearAuthState(false);
  queryClient.clear();
  applyAuthData({
    user,
    accessToken: "token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    session: {
      idleExpiresAt: "2099-01-01T00:00:00.000Z",
      absoluteExpiresAt: "2099-01-01T00:00:00.000Z",
    },
  }, false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: {
      notes: [{
        id: "note-one",
        title: "",
        content: "",
        color: "DEFAULT",
        isPinned: false,
        archivedAt: null,
        trashedAt: null,
        version: 1,
        createdAt: "2026-09-02T00:38:48.210Z",
        updatedAt: "2026-09-02T00:38:48.210Z",
        images: [],
      }],
      nextCursor: null,
    },
  }), { headers: { "Content-Type": "application/json" } })));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NotesWorkspace onClose={() => {}} />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(host.textContent).toContain("Untitled note");
    });
    expect(host.textContent).toContain("No content yet");
    expect(host.textContent).toContain("1 loaded");
    expect(host.textContent).not.toContain("Create first note");
  } finally {
    act(() => root.unmount());
    host.remove();
    clearAuthState(false);
    queryClient.clear();
    vi.unstubAllGlobals();
  }
});
