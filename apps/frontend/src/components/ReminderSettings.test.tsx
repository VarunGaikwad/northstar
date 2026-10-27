// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CenterClock } from "./CenterClock";
import { dueReminder, isDailyReminder } from "../hooks/useDailyReminders";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Alex" } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
const click = (text: string) => act(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  button.click();
});
const close = () => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const mount = () => act(() => root.render(<CenterClock />));
const remount = () => {
  act(() => root.unmount());
  root = createRoot(host);
  mount();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 1, 12, 29, 59));
  localStorage.clear();
  localStorage.setItem("greeting.language", '"en"');
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("adds lunch, fires at the configured time, persists completion and repeats next day", () => {
  mount();
  click("Greeting & reminders");
  expect(document.querySelector<HTMLInputElement>("#reminder-task")!.value).toBe("Lunch break");
  act(() => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(JSON.parse(localStorage.getItem("greeting.reminders")!)[0]).toMatchObject({ task: "Lunch break", time: "12:30" });
  close();
  expect(host.querySelector("h1")!.textContent).toContain("Good afternoon");
  act(() => vi.advanceTimersByTime(1000));
  expect(host.querySelector("h1")!.textContent).toBe("Time to: Lunch break, Alex.");
  remount();
  expect(host.querySelector("h1")!.textContent).toContain("Lunch break");
  click("Mark done");
  expect(host.querySelector("h1")!.textContent).toContain("Good afternoon");
  remount();
  expect(host.querySelector("h1")!.textContent).toContain("Good afternoon");
  vi.setSystemTime(new Date(2026, 5, 2, 12, 30));
  act(() => vi.advanceTimersByTime(1000));
  expect(host.querySelector("h1")!.textContent).toContain("Lunch break");
  click("Greeting & reminders");
  click("Remove");
  expect(JSON.parse(localStorage.getItem("greeting.reminders")!)).toEqual([]);
  close();
  expect(host.querySelector("h1")!.textContent).toContain("Good afternoon");
});

it("handles multiple due tasks in time order, completion and the midnight reset", () => {
  const reminders = [
    { id: "later", task: "Stretch", time: "15:00" },
    { id: "lunch", task: "Lunch break", time: "12:30", completedOn: "2026-6-1" },
  ];
  expect(dueReminder(reminders, new Date(2026, 5, 1, 12, 29))).toBeUndefined();
  expect(dueReminder(reminders, new Date(2026, 5, 1, 16))?.id).toBe("later");
  expect(dueReminder(reminders, new Date(2026, 5, 2, 0))).toBeUndefined();
  expect(dueReminder(reminders, new Date(2026, 5, 2, 16))?.id).toBe("lunch");
});

it("ignores corrupt stored data and invalid reminder entries", () => {
  expect(isDailyReminder({ id: "a", task: "Stretch", time: "25:00" })).toBe(false);
  expect(isDailyReminder({ id: "a", task: " ", time: "12:00" })).toBe(false);
  localStorage.setItem("greeting.reminders", JSON.stringify([null, { time: "bad" }]));
  mount();
  expect(host.querySelector("h1")!.textContent).toContain("Good afternoon");
});
