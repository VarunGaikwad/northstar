import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";

test("forgot password awaits SMTP, hides delivery errors, and does no mail work for unknown accounts", async (t) => {
  const original = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS };
  Object.assign(env, { SMTP_HOST: "smtp.example.com", SMTP_PORT: 587, SMTP_USER: "test", SMTP_PASS: "secret" });
  t.after(() => Object.assign(env, { SMTP_HOST: original.host, SMTP_PORT: original.port, SMTP_USER: original.user, SMTP_PASS: original.pass }));
  let finish: () => void = () => {};
  let fail = false;
  const send = t.mock.fn(async () => {
    if (fail) throw new Error("private recipient token credentials");
    await new Promise<void>((resolve) => { finish = resolve; });
    return { rejected: [] };
  });
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: send }));
  let known = true;
  let updates = 0;
  for (const [method, value] of Object.entries({
    findUnique: () => Promise.resolve(known ? { id: "test", email: "private@example.com" } : null),
    update: () => { updates++; return Promise.resolve({}); },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(prisma.user, method);
    Object.defineProperty(prisma.user, method, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(prisma.user, method, descriptor);
      else Reflect.deleteProperty(prisma.user, method);
    });
  }
  const { forgotPassword } = await import("./auth.service.js");
  let done = false;
  const pending = forgotPassword({ email: "private@example.com" }).then(() => { done = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  assert.equal(send.mock.callCount(), 1);
  finish();
  await pending;
  fail = true;
  const log = t.mock.method(console, "error", () => {});
  await assert.doesNotReject(forgotPassword({ email: "private@example.com" }));
  assert.equal(log.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /private recipient token credentials/);
  known = false;
  await forgotPassword({ email: "unknown@example.com" });
  assert.equal(send.mock.callCount(), 2);
  assert.equal(updates, 2);
});
