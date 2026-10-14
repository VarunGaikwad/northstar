import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { Request } from "express";
import { env } from "../../config/env";
import app from "../../index";
import {
  REFRESH_COOKIE_NAME,
  getRefreshCookieBaseOptions,
  getRefreshCookieOptions,
} from "./auth.cookies";
import { isTrustedOrigin } from "./auth.origin";

test("production refresh cookies are host-only, HttpOnly, secure, and SameSite=None", () => {
  const originalNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const now = new Date("2026-08-15T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60_000);
    assert.equal(REFRESH_COOKIE_NAME, "northstar_refresh_token");
    assert.deepEqual(getRefreshCookieBaseOptions(), {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    assert.deepEqual(getRefreshCookieOptions(expiresAt, now), {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 60_000,
    });
    assert.equal(getRefreshCookieOptions(expiresAt, now).domain, undefined);
  } finally {
    env.NODE_ENV = originalNodeEnv;
  }
});

test("non-local preview environments never use the insecure development cookie", () => {
  const originalNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "preview";
  try {
    assert.deepEqual(getRefreshCookieBaseOptions(), {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
  } finally {
    env.NODE_ENV = originalNodeEnv;
  }
});

test("the insecure cookie variant is limited to HTTP requests on the local API", () => {
  const originalNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "development";
  const localRequest = { hostname: "localhost", secure: false } as Request;
  const ipv6LocalRequest = { hostname: "[::1]", secure: false } as Request;
  const remoteRequest = { hostname: "api.example.com", secure: true } as Request;
  try {
    assert.deepEqual(getRefreshCookieBaseOptions(localRequest), {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
    assert.equal(getRefreshCookieBaseOptions(ipv6LocalRequest).secure, false);
    assert.equal(getRefreshCookieBaseOptions(remoteRequest).secure, true);
  } finally {
    env.NODE_ENV = originalNodeEnv;
  }
});

test("trusted-origin checks are exact and allow non-browser clients without Origin", () => {
  const configuredWebOrigin = env.FRONTEND_URLS[0];
  const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  env.TRUSTED_ORIGINS.push(extensionOrigin);
  try {
    assert.equal(isTrustedOrigin(undefined), true);
    assert.equal(isTrustedOrigin(configuredWebOrigin), true);
    assert.equal(isTrustedOrigin(extensionOrigin), true);
    assert.equal(
      isTrustedOrigin("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"),
      false,
    );
    assert.equal(isTrustedOrigin(`${configuredWebOrigin}.evil.example`), false);
  } finally {
    env.TRUSTED_ORIGINS.pop();
  }
});

test("CORS reflects exact trusted origins with credentials and rejects arbitrary extensions", async (t) => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const trustedOrigin = env.FRONTEND_URLS[0];

  const trusted = await fetch(`${baseUrl}/health`, {
    headers: { Origin: trustedOrigin },
  });
  assert.equal(trusted.status, 200);
  assert.equal(trusted.headers.get("access-control-allow-origin"), trustedOrigin);
  assert.equal(trusted.headers.get("access-control-allow-credentials"), "true");

  const untrusted = await fetch(`${baseUrl}/health`, {
    headers: {
      Origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba",
    },
  });
  assert.equal(untrusted.status, 403);
  assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
});

test("missing refresh credentials return generic 401 and clear the cookie", async (t) => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/refresh`, {
    method: "POST",
    headers: { Origin: env.FRONTEND_URLS[0] },
  });
  const body = (await response.json()) as { success: boolean; error: string };

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    success: false,
    error: "Invalid or expired refresh session",
  });
  assert.match(response.headers.get("set-cookie") ?? "", /northstar_refresh_token=;/);
  assert.match(response.headers.get("set-cookie") ?? "", /Path=\//);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
});
