// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LinkFormModal } from "./LinkFormModal";
import { Modal } from "./Modal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const save = vi.fn();
const close = vi.fn();
const render = () => act(() => root.render(<LinkFormModal open link={null} onClose={close} onSave={save} />));
const setInput = (element: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(() => {
  host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const press = (key: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => { document.dispatchEvent(event); });
  return event;
};
beforeEach(() => {
  save.mockReset();
  close.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("keeps omitted saving/error props backward-compatible and rejects empty trimmed values", () => {
  render();
  const [name, url] = host.querySelectorAll<HTMLInputElement>("input");
  expect(name.disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  setInput(name, "  ");
  setInput(url, "example.com");
  submit();
  expect(save).not.toHaveBeenCalled();
  setInput(name, "  Example  ");
  setInput(url, "  ");
  submit();
  expect(save).not.toHaveBeenCalled();
  setInput(url, "  HTTP://example.com/path  ");
  submit();
  expect(save).toHaveBeenCalledExactlyOnceWith("Example", "HTTP://example.com/path");
  press("Escape");
  expect(close).toHaveBeenCalledTimes(1);
});

it("preserves normal focus wrapping, overlay dismissal and previous focus restoration", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  act(() => root.render(<Modal open title="Edit Bookmark" onClose={close}><input /><button>Save</button></Modal>));
  const buttons = host.querySelectorAll<HTMLButtonElement>("button");
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  expect(document.activeElement).toBe(first);
  expect(press("Tab", true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
  expect(press("Tab").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  act(() => host.querySelector<HTMLElement>('[role="dialog"]')!.click());
  expect(close).toHaveBeenCalledTimes(1);
  act(() => root.render(<Modal open={false} title="Edit Bookmark" onClose={close}>{null}</Modal>));
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it("focuses the panel when opened with no enabled controls and keeps cleanup fallback", () => {
  const workspace = document.createElement("div");
  workspace.id = "notes-workspace";
  const fallback = document.createElement("button");
  fallback.setAttribute("aria-label", "Close notes");
  workspace.append(fallback);
  const trigger = document.createElement("button");
  workspace.append(trigger);
  document.body.append(workspace);
  trigger.focus();
  act(() => root.render(<Modal open title="Saving" dismissible={false} onClose={close}><input disabled /></Modal>));
  const panel = host.querySelector('[role="dialog"]')!.firstElementChild;
  expect(document.activeElement).toBe(panel);
  expect(press("Tab").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(panel);
  trigger.remove();
  act(() => root.render(<Modal open={false} title="Saving" onClose={close}>{null}</Modal>));
  expect(document.activeElement).toBe(fallback);
  workspace.remove();
});
