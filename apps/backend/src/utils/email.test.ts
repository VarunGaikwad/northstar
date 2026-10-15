import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { env } from "../config/env";

test("SMTP reset delivery uses backend links, safe encoding, bounded TLS settings and awaited acceptance", async (t) => {
  const original = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, node: env.NODE_ENV, url: process.env.PUBLIC_BACKEND_URL };
  Object.assign(env, { SMTP_HOST: "smtp.example.com", SMTP_PORT: 587, SMTP_USER: "test", SMTP_PASS: "secret", NODE_ENV: "production" });
  process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
  t.after(() => {
    Object.assign(env, { SMTP_HOST: original.host, SMTP_PORT: original.port, SMTP_USER: original.user, SMTP_PASS: original.pass, NODE_ENV: original.node });
    if (original.url === undefined) delete process.env.PUBLIC_BACKEND_URL;
    else process.env.PUBLIC_BACKEND_URL = original.url;
  });
  let options: unknown;
  let message: { text: string; html: string; to: string } | undefined;
  let deliver: () => void = () => {};
  let rejected = false;
  t.mock.method(nodemailer, "createTransport", (config: unknown) => {
    options = config;
    return { sendMail: async (mail: typeof message) => {
      message = mail;
      await new Promise<void>((resolve) => { deliver = resolve; });
      return { rejected: rejected ? ["private@example.com"] : [] };
    } };
  });
  const { sendPasswordResetEmail } = await import("./email.js");
  let done = false;
  const pending = sendPasswordResetEmail("private@example.com", "a&b").then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  deliver();
  await pending;
  assert.deepEqual(options, {
    host: "smtp.example.com", port: 587, secure: false, requireTLS: true,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    auth: { user: "test", pass: "secret" },
  });
  assert.ok(message);
  assert.match(message.text, /https:\/\/api.example.com\/reset-password\?token=a%26b/);
  assert.match(message.html, /expires in one hour/);
  assert.match(message.text, /ignore this email/);
  rejected = true;
  const failure = sendPasswordResetEmail("private@example.com", "token");
  deliver();
  await assert.rejects(failure, /recipient rejected/);
});

test("PUBLIC_BACKEND_URL validates exact origins and requires HTTPS in production", () => {
  const original = process.env.PUBLIC_BACKEND_URL;
  const node = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    for (const value of ["", "http://api.example.com", "https://a.example,https://b.example", "https://api.example.com/path", "https://user:secret@api.example.com"]) {
      process.env.PUBLIC_BACKEND_URL = value;
      assert.throws(() => env.PUBLIC_BACKEND_URL);
    }
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com/";
    assert.equal(env.PUBLIC_BACKEND_URL, "https://api.example.com");
    delete process.env.PUBLIC_BACKEND_URL;
    process.env.NODE_ENV = "development";
    assert.equal(env.PUBLIC_BACKEND_URL, "http://localhost:3000");
  } finally {
    if (original === undefined) delete process.env.PUBLIC_BACKEND_URL;
    else process.env.PUBLIC_BACKEND_URL = original;
    if (node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = node;
  }
});
