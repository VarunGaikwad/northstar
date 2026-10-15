import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { Request, Response } from "express";
import app from "../index";
import { prisma } from "../db/prisma";
import { forgotPasswordPage } from "../modules/auth/forgot-page";
import { lrtPage } from "../modules/lrt/lrt-page";

function render(handler: typeof lrtPage) {
  let html = "";
  handler({} as Request, { set() { return this; }, type() { return this; }, send(value: string) { html = value; } } as unknown as Response);
  return html;
}

class Element {
  value = "";
  textContent = "";
  disabled = false;
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: { preventDefault(): void }) => Promise<void>> = {};
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, fn: (event: { preventDefault(): void }) => Promise<void>) { this.listeners[name] = fn; }
  reportValidity() { return true; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  submit() { return this.listeners.submit({ preventDefault() {} }); }
}

function browser(handler: typeof lrtPage, response: unknown, statusCode = 200) {
  const elements: Record<string, Element> = {};
  const calls: { url: string; init: RequestInit }[] = [];
  const element = (id: string) => elements[id] ??= new Element();
  const script = render(handler).match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  runInNewContext(script, {
    document: { getElementById: element, createElement: () => new Element() },
    URLSearchParams, Intl, Date, AbortSignal,
    fetch: (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: statusCode < 400, status: statusCode, json: () => Promise.resolve(response) });
    },
  });
  return { element, calls };
}

// Exercise mounts and API without Authorization or cookies, not just isolated handlers.
test("backend recovery and LRT pages and timetable API are public", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(prisma.lrtTrip, "findMany");
  Object.defineProperty(prisma.lrtTrip, "findMany", { configurable: true, value: () => Promise.resolve([
    { tripIndex: 1, dayType: "WEEKDAY", direction: "INBOUND", trainType: "LOCAL", firstDepartMins: 360, stopTimes: [] },
  ]) });
  t.after(() => {
    if (descriptor) Object.defineProperty(prisma.lrtTrip, "findMany", descriptor);
    else Reflect.deleteProperty(prisma.lrtTrip, "findMany");
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ["/forgot-password", "/lrt"]) {
    const response = await fetch(base + path + "?untrusted=never-reflect-me");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const nonce = html.match(/<script nonce="([^"]+)">/)?.[1];
    assert.ok(nonce);
    assert.ok(html.includes(`<style nonce="${nonce}">`));
    assert.ok(response.headers.get("content-security-policy")?.includes(`script-src 'nonce-${nonce}'`));
    assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.doesNotMatch(html, /never-reflect-me|innerHTML/);
  }
  const response = await fetch(base + "/api/lrt/timetable?date=2026-04-01");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { success: boolean }).success, true);
});

test("request UI posts email without credentials and preserves generic success", async () => {
  const page = browser(forgotPasswordPage, { success: true });
  page.element("email").value = " user@example.com ";
  await page.element("request-form").submit();
  assert.equal(page.calls[0].url, "/api/auth/forgot-password");
  assert.equal(page.calls[0].init.credentials, "omit");
  assert.deepEqual(JSON.parse(page.calls[0].init.body as string), { email: "user@example.com" });
  assert.match(page.element("status").textContent, /If an account exists/);
  assert.equal(page.element("submit").disabled, false);
});

test("request UI handles throttling and server errors with retry available", async () => {
  for (const code of [429, 500]) {
    const page = browser(forgotPasswordPage, { success: false }, code);
    await page.element("request-form").submit();
    assert.match(page.element("status").textContent, code === 429 ? /Too many requests/ : /could not send/);
    assert.equal(page.element("submit").disabled, false);
  }
});

test("timetable renders stops safely, next-day times and filtered requests", async () => {
  const page = browser(lrtPage, { success: true, data: {
    date: "2026-04-01", dayType: "WEEKDAY", directions: [{ direction: "INBOUND", trips: [{
      firstDeparture: "0:15", firstDepartureNextDay: true, trainType: "LOCAL",
      stops: [{ stationName: "<img src=x onerror=alert(1)>", stationNameEn: null, arrival: null, departure: "0:15", isNextDay: true, stopType: "STOP" }],
    }] }],
  } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.match(page.element("status").textContent, /1 trains/);
  const summary = page.element("results").children[1].children[0];
  assert.match(summary.textContent, /next day/);
  assert.match(summary.textContent, /<img/); // textContent, never HTML parsing.
  page.element("direction").value = "INBOUND";
  page.element("day-type").value = "HOLIDAY";
  await page.element("timetable-form").submit();
  assert.match(page.calls[1].url, /direction=INBOUND&dayType=HOLIDAY/);
  assert.equal(page.calls[1].init.credentials, "omit");
});

test("timetable handles empty data and failed responses", async () => {
  for (const code of [200, 500]) {
    const page = browser(lrtPage, { success: true, data: { directions: [] } }, code);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(page.element("status").textContent, code === 200 ? /No trains/ : /could not load/);
    assert.equal(page.element("submit").disabled, false);
  }
});
