// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";
import type { FavLinkSearchResult } from "../hooks/useFavLinkSearch";

const api = vi.hoisted(() => ({
  links: [] as FavLinkSearchResult[],
  mutate: vi.fn(),
}));
vi.mock("../hooks/useFavLinkSearch", () => ({
  useFavLinkSearch: (query: string) => ({
    matches: api.links.filter((link) => `${link.title} ${link.url}`.toLowerCase().includes(query.trim().toLowerCase())),
  }),
}));
vi.mock("../hooks/useLocalStorage", async () => {
  const { useState } = await import("react");
  return { useLocalStorage: (_key: string, initial: string) => useState(initial) };
});
vi.mock("../api/endpoints/favlinks", async () => {
  const { useState } = await import("react");
  return {
    useUpdateFavLink: () => {
      const [isPending, setPending] = useState(false);
      return {
        isPending,
        mutateAsync: async (payload: { id: string; title: string; url: string }) => {
          setPending(true);
          try {
            await api.mutate(payload);
            api.links = api.links.map((link) => link.id === payload.id ? { ...link, ...payload, displayHost: new URL(payload.url).host } : link);
          } finally {
            setPending(false);
          }
        },
      };
    },
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let open: ReturnType<typeof vi.spyOn>;
const searchInput = () => host.querySelector<HTMLInputElement>("input")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (text: string, scope: ParentNode = document.body) => {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === text || item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
const click = (element: HTMLElement) => act(() => element.click());
const input = (element: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (target: EventTarget, value: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
};
const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const flushFrames = () => act(() => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
});
function search(value = "alpha") {
  act(() => searchInput().focus());
  input(searchInput(), value);
  flushFrames();
}
function edit(title = "Alpha Two") {
  search();
  click(button(`Edit ${title}`));
  return Array.from(dialog()!.querySelectorAll<HTMLInputElement>("input"));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  api.links = [
    { id: "one", title: "Alpha One", url: "https://one.example", folderId: "folder-one", displayHost: "one.example", createdAt: "2025-01-01", updatedAt: "2025-01-01" },
    { id: "two", title: "Alpha Two", url: "https://two.example", folderId: "folder-two", displayHost: "two.example", createdAt: "2025-01-01", updatedAt: "2025-01-01" },
  ];
  api.mutate.mockReset().mockResolvedValue(undefined);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  open = vi.spyOn(window, "open").mockReturnValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<SearchBar />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SearchBar bookmark editing", () => {
  it.each(["Cancel", "Escape"])("opens the chosen bookmark without navigation and restores query/focus on %s", (dismissal) => {
    search();
    expect(host.querySelector("button button")).toBeNull();
    const pencil = button("Edit Alpha Two");
    act(() => pencil.focus());
    click(pencil);
    const fields = dialog()!.querySelectorAll<HTMLInputElement>("input");
    expect(dialog()!.parentElement).toBe(document.body);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(Array.from(fields, (field) => field.value)).toEqual(["Alpha Two", "https://two.example"]);
    expect(open).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Edit Alpha One"]')).toBeNull();
    if (dismissal === "Cancel") click(button("Cancel"));
    else key(document, "Escape");
    expect(dialog()).toBeNull();
    expect(searchInput().value).toBe("alpha");
    flushFrames();
    expect(document.activeElement).toBe(searchInput());
    expect(button("Edit Alpha Two")).toBeTruthy();
  });

  it.each(["Alpha Updated", "Unrelated"])("saves only id/title/normalized URL and refreshes results for %s", async (title) => {
    const [name, url] = edit();
    input(name, `  ${title}  `);
    input(url, "  updated.example/path  ");
    await act(async () => { submit(dialog()!.querySelector("form")!); });
    expect(api.mutate).toHaveBeenCalledExactlyOnceWith({ id: "two", title, url: "https://updated.example/path" });
    expect(api.links[1].folderId).toBe("folder-two");
    expect(dialog()).toBeNull();
    flushFrames();
    expect(searchInput().value).toBe("alpha");
    expect(document.activeElement).toBe(searchInput());
    expect(host.querySelector('[aria-label="Edit Alpha Two"]')).toBeNull();
    expect(Boolean(host.querySelector(`[aria-label="Edit ${title}"]`))).toBe(title.startsWith("Alpha"));
    expect(open).not.toHaveBeenCalled();
  });

  it("blocks synchronous duplicate submits, disables controls, and traps focus/dismissal while pending", async () => {
    const pending = deferred();
    api.mutate.mockReturnValue(pending.promise);
    edit();
    const form = dialog()!.querySelector("form")!;
    act(() => { submit(form); submit(form); });
    expect(api.mutate).toHaveBeenCalledTimes(1);
    const overlay = dialog()!;
    expect(Array.from(overlay.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")).every((control) => control.disabled)).toBe(true);
    expect(overlay.querySelector('[aria-label="Close modal"]')).toBeNull();
    const panel = overlay.firstElementChild as HTMLElement;
    expect(panel.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(panel);
    for (const shift of [false, true]) {
      act(() => searchInput().focus());
      expect(key(document, "Tab", shift).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(panel);
    }
    key(document, "Escape");
    click(overlay);
    expect(dialog()).toBe(overlay);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(dialog()).toBeNull();
    flushFrames();
    expect(document.activeElement).toBe(searchInput());
  });

  it("retains edited values on failure, exposes an alert and supports retry", async () => {
    const pending = deferred();
    api.mutate.mockReturnValueOnce(pending.promise);
    const [name, url] = edit();
    input(name, "Alpha Retry");
    input(url, "retry.example");
    act(() => { submit(dialog()!.querySelector("form")!); });
    await act(async () => { pending.reject(new Error("Save unavailable")); await pending.promise.catch(() => {}); });
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe("Save unavailable");
    expect(name.value).toBe("Alpha Retry");
    expect(url.value).toBe("retry.example");
    expect(name.disabled).toBe(false);
    expect(button("Cancel").disabled).toBe(false);
    await act(async () => { submit(dialog()!.querySelector("form")!); });
    expect(api.mutate).toHaveBeenCalledTimes(2);
    expect(api.mutate).toHaveBeenLastCalledWith({ id: "two", title: "Alpha Retry", url: "https://retry.example" });
    expect(dialog()).toBeNull();
  });

  it("preserves normal result clicks, arrow/Enter selection and search fallback", () => {
    search();
    const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("Alpha One"))!;
    click(result);
    expect(open).toHaveBeenLastCalledWith("https://one.example", "_blank", "noopener");
    expect(searchInput().value).toBe("");
    search();
    key(searchInput(), "ArrowDown");
    key(searchInput(), "Enter");
    // jsdom does not perform the browser's implicit Enter form submission.
    act(() => { submit(searchInput().form!); });
    expect(open).toHaveBeenLastCalledWith("https://one.example", "_blank", "noopener");
    search();
    key(searchInput(), "ArrowDown");
    key(searchInput(), "ArrowDown");
    key(searchInput(), "Enter");
    act(() => { submit(searchInput().form!); });
    expect(open).toHaveBeenLastCalledWith("https://two.example", "_blank", "noopener");
    search("no match & more");
    key(searchInput(), "ArrowDown");
    act(() => { submit(searchInput().form!); });
    expect(open).toHaveBeenLastCalledWith("https://www.google.com/search?q=no%20match%20%26%20more", "_blank", "noopener");
    search("plain query");
    act(() => { submit(searchInput().form!); });
    expect(open).toHaveBeenLastCalledWith("https://www.google.com/search?q=plain%20query", "_blank", "noopener");
    expect(dialog()).toBeNull();
  });
});
