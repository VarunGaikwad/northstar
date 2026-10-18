import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { Request, Response } from "express";
import app from "../index";
import { prisma } from "../db/prisma";
import { forgotPasswordPage } from "../modules/auth/forgot-page";
import { lrtPage } from "../modules/lrt/lrt-page";

const stations = Array.from({ length: 5 }, (_, code) => ({
  code,
  name: code === 1 ? "<img src=x onerror=alert(1)>" : `駅${code}`,
  nameEn: code === 1 ? null : `Station ${code}`,
  nameRomaji: null,
}));

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
  change() { return this.listeners.change({ preventDefault() {} }); }
}

function browser(handler: typeof lrtPage, response: unknown, statusCode = 200, stationResponse: { status: number; body: unknown } = {
  status: 200, body: { success: true, data: { stations } },
}) {
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
      const reply = url === "/api/lrt/stations" ? stationResponse : { status: statusCode, body: response };
      return Promise.resolve({ ok: reply.status < 400, status: reply.status, json: () => Promise.resolve(reply.body) });
    },
  });
  return { element, calls };
}

// Exercise mounts and API without Authorization or cookies, not just isolated handlers.
test("backend welcome, recovery and LRT pages, favicon and public APIs are available", async (t) => {
  const methods = [
    { target: prisma.lrtTrip, name: "findMany", value: () => Promise.resolve([
      { tripIndex: 1, dayType: "WEEKDAY", direction: "INBOUND", trainType: "LOCAL", firstDepartMins: 360,
        stopTimes: stations.map((station) => ({ station, stopSequence: station.code, stopType: "STOP", arrivalMins: 360 + station.code * 5, departureMins: 360 + station.code * 5, isNextDay: false })) },
    ]) },
    { target: prisma.lrtStation, name: "findMany", value: () => Promise.resolve(stations) },
    { target: prisma.lrtStation, name: "findUnique", value: ({ where }: { where: { code: number } }) => Promise.resolve(stations.find((station) => station.code === where.code)) },
  ];
  for (const { target, name, value } of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else Reflect.deleteProperty(target, name);
    });
  }
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ["/", "/reset-password", "/forgot-password", "/lrt"]) {
    const response = await fetch(base + path + "?untrusted=never-reflect-me");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const nonce = html.match(/<style nonce="([^"]+)">/)?.[1];
    assert.ok(nonce);
    assert.ok(response.headers.get("content-security-policy")?.includes(`style-src 'nonce-${nonce}'`));
    assert.ok(response.headers.get("content-security-policy")?.includes("img-src 'self'"));
    assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.match(html, /<link rel="icon" type="image\/png" href="\/favicon\.png">/);
    assert.doesNotMatch(html, /never-reflect-me|innerHTML/);
    if (path === "/") {
      assert.match(html, /<h1 id="welcome-heading">/);
      for (const href of ["/health", "/lrt", "/forgot-password"]) assert.ok(html.includes(`href="${href}"`));
      assert.doesNotMatch(html, /<script|<noscript>/);
    } else {
      assert.ok(html.includes(`<script nonce="${nonce}">`));
      assert.ok(response.headers.get("content-security-policy")?.includes(`script-src 'nonce-${nonce}'`));
    }
  }
  const favicon = await readFile(resolve(__dirname, "../../img/3006627.png"));
  for (const path of ["/favicon.png", "/favicon.ico"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=86400/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), favicon);
  }
  const health = await fetch(base + "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const response = await fetch(base + "/api/lrt/timetable?date=2026-04-01");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { success: boolean }).success, true);
  const stationResponse = await fetch(base + "/api/lrt/stations");
  assert.equal(stationResponse.status, 200);
  assert.deepEqual(await stationResponse.json(), { success: true, data: { stations } });
  const routeResponse = await fetch(base + "/api/lrt/search?date=2026-04-01&from=0&to=3");
  assert.equal(routeResponse.status, 200);
  const route = await routeResponse.json() as { success: boolean; data: { from: { code: number }; to: { code: number }; trips: { from: { time: string }; to: { time: string } }[] } };
  assert.equal(route.success, true);
  assert.equal(route.data.from.code, 0);
  assert.equal(route.data.to.code, 3);
  assert.equal(route.data.trips[0].from.time, "6:00");
  assert.equal(route.data.trips[0].to.time, "6:15");
  assert.equal((await fetch(base + "/api/lrt/search?from=0&to=0")).status, 400);
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
  assert.match(page.calls.at(-1)!.url, /direction=INBOUND&dayType=HOLIDAY/);
  assert.equal(page.calls.at(-1)!.init.credentials, "omit");
});

test("timetable handles empty data and failed responses", async () => {
  for (const code of [200, 500]) {
    const page = browser(lrtPage, { success: true, data: { directions: [] } }, code);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(page.element("status").textContent, code === 200 ? /No trains/ : /could not load/);
    assert.equal(page.element("submit").disabled, false);
  }
});

test("LRT station selectors load public station names safely, including station code zero", async () => {
  const html = render(lrtPage);
  assert.match(html, /<label for="from">From station/);
  assert.match(html, /<label for="to">To station/);
  const page = browser(lrtPage, { success: true, data: { directions: [] } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const request = page.calls.find((call) => call.url === "/api/lrt/stations");
  assert.ok(request);
  assert.equal(request.init.credentials, "omit");
  for (const id of ["from", "to"]) {
    const select = page.element(id);
    assert.equal(select.disabled, false);
    assert.equal(select.children.length, stations.length);
    assert.equal(select.children[0].value, "0");
    assert.equal(select.children[0].textContent, "Station 0 · 駅0");
    assert.equal(select.children[1].textContent, stations[1].name);
  }
  assert.equal(page.element("station-status").textContent, "");
});

test("LRT rejects partial and identical station pairs without requesting trains", async () => {
  const page = browser(lrtPage, { success: true, data: { directions: [] } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const initialCalls = page.calls.length;
  for (const [from, to] of [["0", ""], ["", "3"], ["0", "0"]]) {
    page.element("from").value = from;
    page.element("to").value = to;
    await page.element("from").change();
    assert.equal(page.element("direction").disabled, true);
    await page.element("timetable-form").submit();
    assert.match(page.element("status").textContent, from === to ? /two different stations/ : /Choose both From and To/);
    assert.equal(page.calls.length, initialCalls);
    assert.equal(page.element("submit").disabled, false);
  }
  page.element("from").value = page.element("to").value = "";
  await page.element("to").change();
  assert.equal(page.element("direction").disabled, false);
  await page.element("timetable-form").submit();
  assert.match(page.calls.at(-1)!.url, /^\/api\/lrt\/timetable\?/);
});

test("LRT searches both directions and shows selected endpoint times and only journey stops", async () => {
  for (const [fromCode, toCode] of [[0, 3], [3, 1]]) {
    const from = stations[fromCode];
    const to = stations[toCode];
    const direction = fromCode < toCode ? "INBOUND" : "OUTBOUND";
    const page = browser(lrtPage, { success: true, data: {
      date: "2026-04-01", dayType: "HOLIDAY", direction, from, to, directions: [], trips: [{
        trainType: "RAPID", durationMins: 10,
        from: { stationCode: fromCode, stationName: from.name, stationNameEn: from.nameEn, time: "23:55", isNextDay: false },
        to: { stationCode: toCode, stationName: to.name, stationNameEn: to.nameEn, time: "0:05", isNextDay: true },
        stops: stations.map((station) => ({
          stationCode: station.code, stationName: station.name, stationNameEn: station.nameEn,
          arrival: station.code === toCode ? "0:05" : null,
          departure: station.code === fromCode ? "23:55" : null,
          isNextDay: station.code === toCode,
          stopType: station.code === 2 ? "PASS" : "STOP",
        })),
      }],
    } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    page.element("from").value = String(fromCode);
    page.element("to").value = String(toCode);
    page.element("date").value = "2026-04-01";
    page.element("direction").value = "OUTBOUND"; // Station order, not the full timetable filter, determines the route.
    page.element("day-type").value = "HOLIDAY";
    await page.element("timetable-form").submit();
    const request = page.calls.at(-1)!;
    const url = new URL(request.url, "http://localhost");
    assert.equal(url.pathname, "/api/lrt/search");
    assert.deepEqual(Object.fromEntries(url.searchParams), { date: "2026-04-01", from: String(fromCode), to: String(toCode), dayType: "HOLIDAY" });
    assert.equal(request.init.credentials, "omit");
    const names = (station: typeof from) => station.nameEn || station.name;
    assert.match(page.element("results").children[0].textContent, direction === "INBOUND" ? /Inbound/ : /Outbound/);
    const details = page.element("results").children[1];
    assert.equal(details.children[0].textContent, `23:55 · ${names(from)} → ${names(to)} · arrives 0:05 (next day) · 10 min · RAPID`);
    const rows = details.children[1].children[0].children[1].children;
    const journey = stations.slice(Math.min(fromCode, toCode), Math.max(fromCode, toCode) + 1);
    if (direction === "OUTBOUND") journey.reverse();
    assert.deepEqual(rows.map((row) => row.children[0].textContent), journey.map(names));
    assert.equal(rows[journey.findIndex((station) => station.code === 2)].children[1].textContent, "Passes");
    assert.equal(rows.at(-1)!.children[1].textContent, "0:05 (next day)");
    assert.equal(page.element("submit").disabled, false);
    assert.equal(page.element("results").attributes["aria-busy"], "false");
  }
});

test("LRT route searches handle no trains, missing data and server errors with retry available", async () => {
  for (const code of [200, 404, 500]) {
    const page = browser(lrtPage, { success: true, data: { directions: [], from: stations[0], to: stations[3], trips: [] } }, code);
    await new Promise<void>((resolve) => setImmediate(resolve));
    page.element("from").value = "0";
    page.element("to").value = "3";
    await page.element("timetable-form").submit();
    assert.match(page.element("status").textContent, code === 200 ? /No trains found between these stations/ : code === 404 ? /No route data/ : /could not load/);
    assert.equal(page.element("submit").disabled, false);
    assert.equal(page.element("results").attributes["aria-busy"], "false");
  }
});

test("LRT keeps the full timetable available when stations are empty or unavailable", async () => {
  for (const status of [200, 503]) {
    const page = browser(lrtPage, { success: true, data: { directions: [] } }, 200, {
      status, body: { success: status === 200, data: { stations: [] } },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(page.element("station-status").textContent, status === 200 ? /No station data/ : /could not load stations/);
    assert.equal(page.element("from").disabled, true);
    assert.equal(page.element("to").disabled, true);
    await page.element("timetable-form").submit();
    assert.match(page.calls.at(-1)!.url, /^\/api\/lrt\/timetable\?/);
    assert.match(page.element("status").textContent, /No trains found for this schedule/);
  }
});
