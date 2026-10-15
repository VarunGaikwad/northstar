import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { limitForgotPassword, limitResetPassword } from "./password-reset-limit";

const WINDOW_MS = 15 * 60 * 1000;
type LimitRow = { count: number; expiresAt: number };
type QueryResult = { count: number; retryAfter: number }[];
type Limiter = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function mockRaw(t: TestContext, implementation: (query: Prisma.Sql) => Promise<QueryResult>) {
  const original = Object.getOwnPropertyDescriptor(prisma, "$queryRaw");
  const mocked = t.mock.fn(implementation);
  Object.defineProperty(prisma, "$queryRaw", { configurable: true, value: mocked });
  t.after(() => {
    if (original) Object.defineProperty(prisma, "$queryRaw", original);
    else Reflect.deleteProperty(prisma, "$queryRaw");
  });
  return mocked;
}

function mockDatabase(t: TestContext) {
  const rows = new Map<string, LimitRow>();
  const database = { now: 0, rows, queries: [] as Prisma.Sql[] };
  mockRaw(t, (query) => {
    database.queries.push(query);
    const [id, limit] = query.values as [string, number];
    assert.equal(query.values.length, 2);
    assert.match(query.sql, /INSERT INTO "PasswordResetLimit"/);
    assert.match(query.sql, /ON CONFLICT \("id"\) DO UPDATE/);
    assert.match(query.sql, /CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/);
    assert.match(query.sql, /LEAST\("PasswordResetLimit"\."count", \?\) \+ 1/);
    let row = rows.get(id);
    if (!row || row.expiresAt <= database.now) {
      row = { count: 1, expiresAt: database.now + WINDOW_MS };
      rows.set(id, row);
    } else {
      row.count = Math.min(row.count, limit) + 1;
    }
    return Promise.resolve([{ count: row.count, retryAfter: Math.max(1, Math.ceil((row.expiresAt - database.now) / 1000)) }]);
  });
  return database;
}

function request(
  email = "unknown@example.com",
  ip = "192.0.2.1",
  headers: Record<string, string> = {},
): Request {
  return {
    body: { email, token: "never-key-on-this-token", password: "Password123!" },
    socket: { remoteAddress: ip },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

async function invoke(limiter: Limiter, req: Request) {
  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
  } as unknown as Response;
  let called = false;
  let error: unknown;
  await limiter(req, res, (value?: unknown) => {
    called = true;
    error = value;
  });
  assert.equal(called, true);
  return { error, headers };
}

function expectedKey(scope: string, value: string) {
  return `${scope}:${createHmac("sha256", env.JWT_SECRET).update(value).digest("hex")}`;
}

function assertLimited(result: Awaited<ReturnType<typeof invoke>>, retryAfter: string) {
  assert.ok(result.error instanceof ApiError);
  assert.equal(result.error.statusCode, 429);
  assert.equal(result.error.message, "Too many requests. Please try again later.");
  assert.equal(result.headers.get("retry-after"), retryAfter);
}

test("forgot email budget is normalized, HMAC-only, account-independent, and reuses expired rows", async (t) => {
  const database = mockDatabase(t);
  const email = "unknown@example.com";
  for (let i = 0; i < 3; i++) {
    const result = await invoke(limitForgotPassword, request("UNKNOWN@EXAMPLE.COM", `192.0.2.${i + 1}`));
    assert.equal(result.error, undefined);
    assert.equal(result.headers.has("retry-after"), false);
  }
  const id = expectedKey("forgot-email", email);
  const firstRow = database.rows.get(id);
  assert.ok(firstRow);
  assert.equal(firstRow.count, 3);
  assert.equal(firstRow.expiresAt, WINDOW_MS);
  assert.equal([...database.rows.keys()].filter((key) => key.startsWith("forgot-email:")).length, 1);
  for (const query of database.queries) {
    assert.equal(query.sql.includes(email), false);
    assert.equal(query.values.some((value) => String(value).includes(email)), false);
    assert.match(String(query.values[0]), /^(forgot-ip|forgot-email):[a-f0-9]{64}$/);
  }

  database.now = 1_234;
  assertLimited(await invoke(limitForgotPassword, request(email, "192.0.2.4")), "899");
  assert.equal(database.rows.get(id)?.expiresAt, WINDOW_MS);
  for (let i = 0; i < 3; i++) {
    assertLimited(await invoke(limitForgotPassword, request(email, `192.0.2.${i + 5}`)), "899");
  }
  assert.equal(database.rows.get(id)?.count, 4, "blocked requests cannot overflow the counter");

  database.now = WINDOW_MS;
  assert.equal((await invoke(limitForgotPassword, request(email, "192.0.2.9"))).error, undefined);
  assert.deepEqual(database.rows.get(id), { count: 1, expiresAt: WINDOW_MS * 2 });
  assert.equal([...database.rows.keys()].filter((key) => key.startsWith("forgot-email:")).length, 1);
});

test("forgot IP budget allows ten requests, then stops before consuming another email budget", async (t) => {
  const database = mockDatabase(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await invoke(limitForgotPassword, request(`unknown-${i}@example.com`))).error, undefined);
  }
  assert.equal(database.queries.length, 20);
  assertLimited(await invoke(limitForgotPassword, request("another@example.com")), "900");
  assert.equal(database.queries.length, 21);
  assert.equal(database.rows.has(expectedKey("forgot-email", "another@example.com")), false);

  database.now = WINDOW_MS;
  assert.equal((await invoke(limitForgotPassword, request("another@example.com"))).error, undefined);
  assert.deepEqual(database.rows.get(expectedKey("forgot-ip", "192.0.2.1")), {
    count: 1,
    expiresAt: WINDOW_MS * 2,
  });
});

test("reset has a separate ten-request IP budget without storing a token or email", async (t) => {
  const database = mockDatabase(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await invoke(limitResetPassword, request(`unknown-${i}@example.com`))).error, undefined);
  }
  assertLimited(await invoke(limitResetPassword, request()), "900");
  assert.deepEqual([...database.rows.keys()], [expectedKey("reset-ip", "192.0.2.1")]);
  assert.equal(database.queries.length, 11);
  assert.equal((await invoke(limitForgotPassword, request())).error, undefined);

  database.now = WINDOW_MS;
  assert.equal((await invoke(limitResetPassword, request())).error, undefined);
  assert.deepEqual(database.rows.get(expectedKey("reset-ip", "192.0.2.1")), {
    count: 1,
    expiresAt: WINDOW_MS * 2,
  });
});

test("IP keys only trust the Vercel platform header on VERCEL=1, never x-forwarded-for", async (t) => {
  const database = mockDatabase(t);
  const original = process.env.VERCEL;
  t.after(() => {
    if (original === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original;
  });
  const headers = {
    "x-forwarded-for": "198.51.100.1",
    "x-vercel-forwarded-for": "203.0.113.1",
  };
  process.env.VERCEL = "0";
  await invoke(limitResetPassword, request("unknown@example.com", "192.0.2.1", headers));
  assert.equal(database.queries.at(-1)?.values[0], expectedKey("reset-ip", "192.0.2.1"));

  process.env.VERCEL = "1";
  await invoke(limitResetPassword, request("unknown@example.com", "192.0.2.1", headers));
  assert.equal(database.queries.at(-1)?.values[0], expectedKey("reset-ip", "203.0.113.1"));
  for (const value of [undefined, "invalid", "203.0.113.1, 198.51.100.1"]) {
    const otherHeaders: Record<string, string> = { "x-forwarded-for": "198.51.100.1" };
    if (value !== undefined) otherHeaders["x-vercel-forwarded-for"] = value;
    await invoke(limitResetPassword, request("unknown@example.com", "192.0.2.1", otherHeaders));
    assert.equal(database.queries.at(-1)?.values[0], expectedKey("reset-ip", "192.0.2.1"));
  }
  await invoke(limitResetPassword, request("unknown@example.com", "::1", {
    "x-vercel-forwarded-for": "2001:db8::1",
  }));
  assert.equal(database.queries.at(-1)?.values[0], expectedKey("reset-ip", "2001:db8::1"));
});

test("database failures fail closed with a generic error, including an email-budget failure", async (t) => {
  let calls = 0;
  mockRaw(t, () => {
    calls++;
    if (calls === 1) return Promise.resolve([{ count: 1, retryAfter: 900 }]);
    return Promise.reject(new Error("private database credentials and unknown@example.com"));
  });
  const result = await invoke(limitForgotPassword, request());
  assert.ok(result.error instanceof ApiError);
  assert.equal(result.error.statusCode, 503);
  assert.equal(result.error.message, "Unable to process request. Please try again later.");
  assert.equal(result.headers.get("retry-after"), "60");
  assert.equal(calls, 2);

  const reset = await invoke(limitResetPassword, request());
  assert.ok(reset.error instanceof ApiError);
  assert.equal(reset.error.statusCode, 503);
});

test("a missing database result fails closed", async (t) => {
  mockRaw(t, () => Promise.resolve([]));
  const result = await invoke(limitResetPassword, request());
  assert.ok(result.error instanceof ApiError);
  assert.equal(result.error.statusCode, 503);
});
