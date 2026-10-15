import type { Request, Response } from "express";
import { publicPage } from "../../utils/public-page";

export function forgotPasswordPage(_req: Request, res: Response): void {
  publicPage(res, "Password recovery", `
<h1>Request a password reset link</h1>
<p>Enter your Northstar email address. Follow the link in your email to choose a new password here.</p>
<form id="request-form"><label for="email">Email address<input id="email" type="email" name="email" autocomplete="email" required maxlength="254"></label>
<button id="submit" type="submit">Send reset link</button></form>
<p id="status" role="status" aria-live="polite"></p>
<p>Already have a reset email? Open its link to set your new password. No sign-in is required.</p>`, String.raw`
const form = document.getElementById("request-form");
const submit = document.getElementById("submit");
const status = document.getElementById("status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled || !form.reportValidity()) return;
  submit.disabled = true;
  form.setAttribute("aria-busy", "true");
  status.textContent = "Requesting your reset link…";
  try {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: document.getElementById("email").value.trim() }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result && result.success) {
      status.textContent = "If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.";
    } else if (response.status === 429) {
      status.textContent = "Too many requests. Please wait before trying again.";
    } else {
      status.textContent = "We could not send your reset link. Please try again later.";
    }
  } catch {
    status.textContent = "We could not reach Northstar. Check your connection and try again.";
  } finally {
    submit.disabled = false;
    form.setAttribute("aria-busy", "false");
  }
});`);
}
