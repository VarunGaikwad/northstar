// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CenterClock } from "./CenterClock";
import { GREETING_LANGUAGE_CODES, GREETING_LANGUAGES, greetingFor, nextGreetingLanguage } from "../utils/greetings";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Alex" } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const render = () => act(() => root.render(<CenterClock />));
const greeting = () => host.querySelector("h1 span")!;
const open = () => act(() => host.querySelector<HTMLButtonElement>("button")!.click());
const select = (value: string) => act(() => {
  const field = document.querySelector("select")!;
  field.value = value;
  field.dispatchEvent(new Event("change", { bubbles: true }));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 1, 9));
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("provides all time-of-day greetings at local time boundaries for every language", () => {
  for (const language of GREETING_LANGUAGE_CODES) {
    for (const [hour, period] of [[0, 0], [11, 0], [12, 1], [17, 1], [18, 2], [23, 2]]) {
      expect(greetingFor(hour, language)).toBe(GREETING_LANGUAGES[language].greetings[period]);
    }
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(nextGreetingLanguage(language)).not.toBe(language);
  }
});

it("defaults to shuffle and rotates after 30 seconds without an immediate repeat", () => {
  render();
  const initial = greeting().getAttribute("lang");
  act(() => vi.advanceTimersByTime(29_000));
  expect(greeting().getAttribute("lang")).toBe(initial);
  act(() => vi.advanceTimersByTime(1000));
  expect(greeting().getAttribute("lang")).not.toBe(initial);
  expect(host.textContent).toContain("Alex");
});

it("saves a fixed language, stops shuffling, restores it on remount and updates time periods", () => {
  render();
  open();
  expect(document.querySelector('[role="dialog"]')?.parentElement).toBe(document.body);
  select("hi");
  expect(greeting().textContent).toBe("सुप्रभात");
  expect(localStorage.getItem("greeting.language")).toBe('"hi"');
  act(() => vi.advanceTimersByTime(60_000));
  expect(greeting().getAttribute("lang")).toBe("hi");
  act(() => root.unmount());
  root = createRoot(host);
  render();
  expect(greeting().getAttribute("lang")).toBe("hi");
  vi.setSystemTime(new Date(2026, 5, 1, 12));
  act(() => vi.advanceTimersByTime(1000));
  expect(greeting().textContent).toBe("शुभ दोपहर");
  vi.setSystemTime(new Date(2026, 5, 1, 18));
  act(() => vi.advanceTimersByTime(1000));
  expect(greeting().textContent).toBe("शुभ संध्या");
  open();
  select("shuffle");
  const initial = greeting().getAttribute("lang");
  act(() => vi.advanceTimersByTime(30_000));
  expect(greeting().getAttribute("lang")).not.toBe(initial);
  expect(localStorage.getItem("greeting.language")).toBe('"shuffle"');
});

it("closes with Escape, restores focus, and safely falls back for invalid stored preferences", () => {
  localStorage.setItem("greeting.language", '"unsupported"');
  render();
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  act(() => trigger.focus());
  open();
  expect(document.querySelector("select")!.value).toBe("shuffle");
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
