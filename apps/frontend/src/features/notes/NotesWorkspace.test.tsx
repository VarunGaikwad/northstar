// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyAuthData, clearAuthState } from "../../auth/session";
import { queryClient } from "../../api/queryClient";
import { notesKeys } from "../../api/endpoints/notes";
import type { Note } from "../../api/types";
import { NotesWorkspace } from "./NotesWorkspace";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-one" } }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const blankNote: Note = {
  id: "note-one", title: "", content: "", color: "DEFAULT", isPinned: false,
  archivedAt: null, trashedAt: null, version: 1,
  createdAt: "2026-09-02T00:38:48.210Z", updatedAt: "2026-09-02T00:38:48.210Z", images: [],
};
let notes: Note[];
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let failId: string | null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const button = (label: string) => {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
async function waitForText(text: string) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain(text);
  });
}
async function render() {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <NotesWorkspace onClose={() => {}} />
    </QueryClientProvider>,
  ));
  await waitForText(`${notes.filter((note) => !note.trashedAt).length} loaded`);
}
const deleteRequests = () => fetchMock.mock.calls.filter(
  ([, options]) => options.method === "POST" || options.method === "DELETE",
);

beforeEach(() => {
  notes = [blankNote];
  failId = null;
  clearAuthState(false);
  queryClient.clear();
  applyAuthData({
    user: {
      id: "user-one", email: "user@example.com", firstName: null, lastName: null,
      role: "USER", isVerified: true, isActive: true,
      createdAt: blankNote.createdAt, updatedAt: blankNote.updatedAt,
    },
    accessToken: "token", accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    session: { idleExpiresAt: "2099-01-01T00:00:00.000Z", absoluteExpiresAt: "2099-01-01T00:00:00.000Z" },
  }, false);
  fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    const path = new URL(url, "https://example.test");
    const id = path.pathname.split("/")[3];
    if (options.method === "GET" && id) {
      return json({ success: true, data: notes.find((note) => note.id === id) });
    }
    if (options.method === "GET") {
      const view = path.searchParams.get("view");
      return json({ success: true, data: {
        notes: notes.filter((note) => view === "trash" ? note.trashedAt : !note.trashedAt), nextCursor: null,
      } });
    }
    if (id === failId) return json({ success: false, error: "Changed elsewhere" }, 412);
    const target = notes.find((note) => note.id === id)!;
    if (new Headers(options.headers).get("X-Note-Version") !== `"${target.version}"`) {
      return json({ success: false, error: "Note version does not match If-Match" }, 412);
    }
    if (options.method === "PATCH") {
      const updated = { ...target, ...JSON.parse(options.body as string), version: target.version + 1 };
      notes = notes.map((note) => note.id === id ? updated : note);
      return json({ success: true, data: updated });
    }
    if (options.method === "DELETE") {
      notes = notes.filter((note) => note.id !== id);
      return json({ success: true, message: "Deleted" });
    }
    const updated = { ...target, trashedAt: "2026-09-03T00:00:00.000Z", version: target.version + 1 };
    notes = notes.map((note) => note.id === id ? updated : note);
    return json({ success: true, data: updated });
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearAuthState(false);
  queryClient.clear();
  vi.unstubAllGlobals();
});

it("renders blank notes from the API notes collection instead of crashing", async () => {
  await render();
  expect(host.textContent).toContain("Untitled note");
  expect(host.textContent).toContain("No content yet");
  expect(host.textContent).not.toContain("Create first note");
});

it("quick deletes without opening the editor and sends the note version", async () => {
  await render();
  await click(button("Delete Untitled note"));
  await waitForText("0 loaded");
  const [[url, options]] = deleteRequests();
  expect(url).toContain("/notes/note-one/trash");
  expect(new Headers(options.headers).get("X-Note-Version")).toBe('"1"');
  expect(notes[0].trashedAt).not.toBeNull();
});

it("refreshes a stale version after a delete conflict and requires an explicit retry", async () => {
  await render();
  queryClient.setQueryData(notesKeys.detail("user-one", blankNote.id), blankNote);
  notes = [{ ...blankNote, title: "Changed in another tab", version: 2 }];

  await click(button("Delete Untitled note"));
  await waitForText("Review the updated note and delete again.");
  await waitForText("Changed in another tab");
  expect(deleteRequests()).toHaveLength(1);
  expect(notes[0].trashedAt).toBeNull();
  expect(queryClient.getQueryData<Note>(notesKeys.detail("user-one", blankNote.id))?.version).toBe(2);

  await click(button("Delete Changed in another tab"));
  await waitForText("0 loaded");
  expect(new Headers(deleteRequests()[1][1].headers).get("X-Note-Version")).toBe('"2"');
});

it("flushes an open editor before quick deletion and uses the saved version", async () => {
  await render();
  await click(host.querySelector("h3")!.closest("button")!);
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.querySelector('[aria-label="Note title"]')).not.toBeNull();
  });
  const title = host.querySelector<HTMLInputElement>('[aria-label="Note title"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Unsaved draft");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Delete Untitled note"));
  await waitForText("0 loaded");
  expect(notes[0].title).toBe("Unsaved draft");
  expect(new Headers(deleteRequests()[0][1].headers).get("X-Note-Version")).toBe('"2"');
  expect(host.querySelector('[aria-label="Note title"]')).toBeNull();
});

it("does not delete a note when its open draft cannot be saved", async () => {
  await render();
  await click(host.querySelector("h3")!.closest("button")!);
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.querySelector('[aria-label="Note title"]')).not.toBeNull();
  });
  failId = "note-one";
  const title = host.querySelector<HTMLInputElement>('[aria-label="Note title"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Keep this draft");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Delete Untitled note"));
  expect(deleteRequests()).toHaveLength(0);
  expect(notes[0].trashedAt).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe("Keep this draft");
});

it("selects individual notes and all loaded notes, preserving failures for retry", async () => {
  notes = [blankNote, { ...blankNote, id: "note-two", title: "Second", version: 4 }];
  failId = "note-two";
  await render();
  await click(button("Select notes"));
  expect(button("Delete selected (0)").disabled).toBe(true);
  await click(host.querySelector<HTMLInputElement>('[aria-label="Select Second"]')!);
  expect(button("Delete selected (1)").disabled).toBe(false);
  await click(button("Select all loaded"));
  await click(button("Deselect all"));
  expect(button("Delete selected (0)").disabled).toBe(true);
  await click(button("Select all loaded"));
  await click(button("Delete selected (2)"));
  await waitForText("1 note(s) could not be deleted.");
  await waitForText("1 loaded");
  expect(deleteRequests()).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Select Second"]')?.checked).toBe(true);
  expect(new Headers(deleteRequests()[1][1].headers).get("X-Note-Version")).toBe('"4"');
  failId = null;
  await click(button("Delete selected (1)"));
  await waitForText("0 loaded");
});

it("requires confirmation for bulk permanent deletion in Trash", async () => {
  notes = [blankNote, { ...blankNote, id: "note-two", title: "Second", trashedAt: blankNote.createdAt }];
  await render();
  await click(button("Select notes"));
  await click(button("Select all loaded"));
  // Desktop and compact switches both exist; choose the first matching label.
  await click(button("Trash"));
  await waitForText("1 loaded");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await click(button("Select notes"));
  await click(button("Select all loaded"));
  await click(button("Delete selected (1)"));
  expect(deleteRequests()).toHaveLength(0);
  expect(document.body.textContent).toContain("This cannot be undone.");
  await click(button("Cancel"));
  expect(deleteRequests()).toHaveLength(0);
  await click(button("Delete selected (1)"));
  await click(button("Delete"));
  await waitForText("0 loaded");
  expect(deleteRequests()[0][1].method).toBe("DELETE");
  expect(notes.map((note) => note.id)).toEqual(["note-one"]);
});
