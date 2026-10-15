import assert from "node:assert/strict";
import { test } from "node:test";
import { emailErrorDetails } from "./email-error";

test("email diagnostics expose only allowlisted codes and numeric SMTP failure status", () => {
  assert.deepEqual(emailErrorDetails({ code: "EAUTH", responseCode: 535, message: "password", response: "recipient token", stack: "secret" }), { code: "EAUTH", responseCode: 535 });
  assert.deepEqual(emailErrorDetails({ code: "ETIMEDOUT" }), { code: "ETIMEDOUT" });
  for (const code of ["ERESETURL", "ESMTPUNCONFIGURED", "ERECIPIENT"]) {
    assert.deepEqual(emailErrorDetails({ code }), { code });
  }
  for (const error of [null, "secret", new Error("secret"), { code: "secret", responseCode: "535 secret" }, { responseCode: 999 }, { responseCode: 535.5 }]) {
    assert.deepEqual(emailErrorDetails(error), { code: "UNKNOWN" });
  }
});
