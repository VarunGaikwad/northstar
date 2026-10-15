import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { prisma } from "../../db/prisma";
import app from "../../index";

test("backend page and recovery routes are wired with origin checks, validation and durable limits", async (t) => {
  const originalUrl = process.env.PUBLIC_BACKEND_URL;
  process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
  t.after(() => {
    if (originalUrl === undefined) delete process.env.PUBLIC_BACKEND_URL;
    else process.env.PUBLIC_BACKEND_URL = originalUrl;
  });
  let limited = false;
  let rawCalls = 0;
  const original = Object.getOwnPropertyDescriptor(prisma, "$queryRaw");
  Object.defineProperty(prisma, "$queryRaw", { configurable: true, value: () => {
    rawCalls++;
    return Promise.resolve([{ count: limited ? 11 : 1, retryAfter: 200 }]);
  } });
  t.after(() => {
    if (original) Object.defineProperty(prisma, "$queryRaw", original);
    else Reflect.deleteProperty(prisma, "$queryRaw");
  });
  const userDescriptor = Object.getOwnPropertyDescriptor(prisma.user, "findUnique");
  Object.defineProperty(prisma.user, "findUnique", { configurable: true, value: () => Promise.resolve(null) });
  t.after(() => {
    if (userDescriptor) Object.defineProperty(prisma.user, "findUnique", userDescriptor);
    else Reflect.deleteProperty(prisma.user, "findUnique");
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const page = await fetch(`${base}/reset-password?token=private-token`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await page.text(), /private-token/);
  assert.equal(rawCalls, 0);
  const post = (path: string, body: object, origin = "https://api.example.com") => fetch(`${base}/api/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
  const body = { token: "expired", password: "NewPassword123!" };
  const untrusted = await post("reset-password", body, "https://evil.example");
  assert.equal(untrusted.status, 403);
  assert.equal(rawCalls, 0);
  const invalid = await post("reset-password", { ...body, password: "weak" });
  assert.equal(invalid.status, 400);
  assert.equal(rawCalls, 0);
  const expired = await post("reset-password", body);
  assert.equal(expired.status, 400);
  assert.equal(((await expired.json()) as { error: string }).error, "Invalid or expired reset token");
  assert.equal(rawCalls, 1);
  limited = true;
  const throttled = await post("reset-password", body);
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("retry-after"), "200");
  limited = false;
  const forgot = await post("forgot-password", { email: "unknown@example.com" }, "http://localhost:5173");
  assert.equal(forgot.status, 200);
  assert.match(((await forgot.json()) as { message: string }).message, /If an account/);
});
