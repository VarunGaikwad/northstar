import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../config/env";

test("production missing SMTP fails operationally without logging a reset link", async (t) => {
  const original = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, node: env.NODE_ENV, url: process.env.PUBLIC_BACKEND_URL };
  Object.assign(env, { SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, NODE_ENV: "production" });
  process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
  t.after(() => {
    Object.assign(env, { SMTP_HOST: original.host, SMTP_PORT: original.port, SMTP_USER: original.user, SMTP_PASS: original.pass, NODE_ENV: original.node });
    if (original.url === undefined) delete process.env.PUBLIC_BACKEND_URL;
    else process.env.PUBLIC_BACKEND_URL = original.url;
  });
  const log = t.mock.method(console, "log", () => {});
  const { sendPasswordResetEmail } = await import("./email.js");
  await assert.rejects(sendPasswordResetEmail("private@example.com", "private-token"), /SMTP is not configured/);
  assert.equal(log.mock.callCount(), 0);
});
