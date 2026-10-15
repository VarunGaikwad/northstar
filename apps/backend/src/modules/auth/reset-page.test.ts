import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import express, { type Request, type Response } from "express";
import { passwordSchema } from "./auth.validation";
import { resetPasswordPage } from "./reset-page";

function renderPage(): string {
  let html = "";
  const response = {
    set() { return this; },
    status() { return this; },
    type() { return this; },
    send(value: string) { html = value; return this; },
  };
  resetPasswordPage({} as Request, response as unknown as Response);
  return html;
}

type Listener = (event: { preventDefault(): void }) => void | Promise<void>;

class ElementStub {
  value = "";
  textContent = "";
  type = "password";
  hidden = false;
  disabled = false;
  focused = false;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, Listener> = {};
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name]; }
  addEventListener(name: string, listener: Listener) { this.listeners[name] = listener; }
  focus() { this.focused = true; }
  async fire(name: string) { await this.listeners[name]?.({ preventDefault() {} }); }
}

type FetchResult = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchStub = (url: string, init: RequestInit) => Promise<FetchResult>;

function browser(search = "?token=private-reset-token", fetchStub?: FetchStub) {
  const elements = Object.fromEntries([
    "reset-form", "fields", "password", "confirm", "password-feedback",
    "confirm-feedback", "status", "submit", "heading", "intro",
  ].map((id) => [id, new ElementStub()]));
  const toggles = ["password", "confirm"].map((id) => {
    const element = new ElementStub();
    element.attributes["aria-controls"] = id;
    element.dataset.toggle = id === "password" ? "new password" : "confirmation password";
    return element;
  });
  const document = new ElementStub();
  const history: unknown[][] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const timeouts = new Map<number, () => void>();
  const html = renderPage();
  const source = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source);
  runInNewContext(source, {
    URLSearchParams,
    AbortController,
    window: {
      location: { search, pathname: "/reset-password" },
      history: { replaceState: (...args: unknown[]) => history.push(args) },
    },
    document: {
      addEventListener: document.addEventListener.bind(document),
      getElementById: (id: string) => elements[id],
      querySelectorAll: () => toggles,
    },
    fetch: (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (!fetchStub) throw new Error("No network response configured");
      return fetchStub(url, init);
    },
    setTimeout: (callback: () => void) => { timeouts.set(1, callback); return 1; },
    clearTimeout: (id: number) => timeouts.delete(id),
  });
  return {
    elements, toggles, history, calls, timeouts,
    ready: () => document.fire("DOMContentLoaded"),
    async fill(value = "ValidPass1!") {
      elements.password.value = value;
      elements.confirm.value = value;
      await elements.password.fire("input");
      await elements.confirm.fire("input");
    },
  };
}

function result(status: number, body: unknown): FetchResult {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

test("handler sends a non-cacheable HTML document with isolated nonce CSP and never reflects a token", async (t) => {
  const app = express();
  app.get("/reset-password", resetPasswordPage);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/reset-password`;
  const malicious = '</script><img src="https://evil.example/secret">';
  const response = await fetch(`${url}?token=${encodeURIComponent(malicious)}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html; charset=utf-8/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("set-cookie"), null);
  const nonce = html.match(/<script nonce="([^"]+)">/)?.[1];
  assert.ok(nonce);
  assert.equal(Buffer.from(nonce, "base64").length, 18);
  assert.ok(html.includes(`<style nonce="${nonce}">`));
  assert.equal(response.headers.get("content-security-policy"), [
    "default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`,
    "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join("; "));
  assert.ok(!html.includes(malicious));
  assert.ok(!html.includes("evil.example"));
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)=/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /<label for="password">/);
  assert.match(html, /<label for="confirm">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<noscript>/);
  const second = await fetch(url);
  await second.text();
  assert.notEqual(second.headers.get("content-security-policy"), response.headers.get("content-security-policy"));
});

test("script removes the entire query immediately, keeps token out of DOM, and does not submit on GET", async () => {
  const page = browser("?token=only-in-memory&tracking=remove-this");
  assert.deepEqual(page.history, [[null, "", "/reset-password"]]);
  assert.equal(page.calls.length, 0);
  await page.ready();
  assert.equal(page.calls.length, 0);
  assert.equal(page.elements["reset-form"].hidden, false);
  assert.equal(page.elements.submit.disabled, true);
  assert.ok(Object.values(page.elements).every((element) => !JSON.stringify(element).includes("only-in-memory")));
});

test("missing and empty tokens show recovery instructions without a form or network request", async () => {
  for (const search of ["", "?token=", "?other=value"]) {
    const page = browser(search);
    await page.ready();
    assert.equal(page.elements["reset-form"].hidden, true);
    assert.match(page.elements.status.textContent, /missing its token/);
    assert.match(page.elements.status.textContent, /extension/);
    assert.equal(page.calls.length, 0);
  }
});

test("client validation matches backend rules, including max length and all non-alphanumeric special characters", async () => {
  const page = browser();
  await page.ready();
  const passwords = [
    "", "Aa1!", "abcdefgh1!", "ABCDEFGH1!", "Abcdefgh!!", "Abcdefgh12", "ValidPass1!",
    "ValidPass1-", "ValidPass1_", "ValidPass1 ", "ValidPass1é", "Ab1!" + "a".repeat(124),
    "Ab1!" + "a".repeat(125), "Aa1!😀😀", "Abcdefg١!",
  ];
  for (const password of passwords) {
    await page.fill(password);
    assert.equal(!page.elements.submit.disabled, passwordSchema.safeParse(password).success, JSON.stringify(password));
  }
  await page.fill();
  page.elements.confirm.value = "Different1!";
  await page.elements.confirm.fire("input");
  assert.equal(page.elements.submit.disabled, true);
  assert.match(page.elements["confirm-feedback"].textContent, /do not match/);
  await page.elements["reset-form"].fire("submit");
  assert.equal(page.calls.length, 0);
});

test("show/hide controls are independent and update accessible state", async () => {
  const page = browser();
  await page.ready();
  await page.toggles[0].fire("click");
  assert.equal(page.elements.password.type, "text");
  assert.equal(page.elements.confirm.type, "password");
  assert.equal(page.toggles[0].attributes["aria-pressed"], "true");
  assert.equal(page.toggles[0].attributes["aria-label"], "Hide new password");
  await page.toggles[0].fire("click");
  await page.toggles[1].fire("click");
  assert.equal(page.elements.password.type, "password");
  assert.equal(page.elements.confirm.type, "text");
});

test("submission is same-origin JSON without cookies, prevents double submit, and clears secrets on success", async () => {
  let finish!: (value: FetchResult) => void;
  const page = browser("?token=secret%2Btoken", () => new Promise((resolve) => { finish = resolve; }));
  await page.ready();
  await page.fill();
  const pending = page.elements["reset-form"].fire("submit");
  assert.equal(page.elements.fields.disabled, true);
  assert.equal(page.elements.submit.disabled, true);
  assert.equal(page.elements["reset-form"].attributes["aria-busy"], "true");
  await page.elements["reset-form"].fire("submit");
  assert.equal(page.calls.length, 1);
  const { url, init } = page.calls[0];
  assert.equal(url, "/api/auth/reset-password");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body as string), { token: "secret+token", password: "ValidPass1!" });
  finish(result(200, { success: true }));
  await pending;
  assert.equal(page.elements["reset-form"].hidden, true);
  assert.equal(page.elements.password.value, "");
  assert.equal(page.elements.confirm.value, "");
  assert.match(page.elements.status.textContent, /Return to the Northstar extension/);
  assert.match(page.elements.status.textContent, /not been signed in automatically/);
  assert.equal(page.timeouts.size, 0);
  await page.fill();
  await page.elements["reset-form"].fire("submit");
  assert.equal(page.calls.length, 1);
});

test("expired/used token has friendly terminal instructions and clears fields", async () => {
  const page = browser(undefined, () => Promise.resolve(result(400, { success: false, error: "Invalid or expired reset token" })));
  await page.ready();
  await page.fill();
  await page.elements["reset-form"].fire("submit");
  assert.equal(page.elements["reset-form"].hidden, true);
  assert.match(page.elements.status.textContent, /expired or has already been used/);
  assert.equal(page.elements.password.value, "");
  assert.equal(page.elements.submit.disabled, true);
});

test("network, timeout, server, malformed response and rate-limit failures allow retry", async () => {
  const failures: FetchStub[] = [
    () => Promise.reject(new TypeError("offline")),
    () => Promise.resolve(result(500, { error: "internal details must not appear" })),
    () => Promise.resolve(result(429, { success: false })),
    () => Promise.resolve(result(400, { error: "Validation failed" })),
    () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError()) }),
    (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("timeout")));
    }),
  ];
  for (const failure of failures) {
    let attempts = 0;
    const page = browser(undefined, (url, init) => ++attempts === 1
      ? failure(url, init)
      : Promise.resolve(result(200, { success: true })));
    await page.ready();
    await page.fill();
    const pending = page.elements["reset-form"].fire("submit");
    page.timeouts.get(1)?.();
    await pending;
    assert.equal(page.elements["reset-form"].hidden, false);
    assert.equal(page.elements.fields.disabled, false);
    assert.equal(page.elements.submit.disabled, false);
    assert.match(page.elements.status.textContent, /try again/);
    assert.doesNotMatch(page.elements.status.textContent, /internal details/);
    assert.equal(page.timeouts.size, 0);
    await page.elements["reset-form"].fire("submit");
    assert.equal(page.calls.length, 2);
    assert.equal(page.elements["reset-form"].hidden, true);
  }
});
