import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";

const script = String.raw`
(() => {
  let token = new URLSearchParams(window.location.search).get("token") || "";
  window.history.replaceState(null, "", window.location.pathname);

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("reset-form");
    const fields = document.getElementById("fields");
    const password = document.getElementById("password");
    const confirm = document.getElementById("confirm");
    const feedback = document.getElementById("password-feedback");
    const match = document.getElementById("confirm-feedback");
    const status = document.getElementById("status");
    const submit = document.getElementById("submit");
    let loading = false;

    function passwordError(value) {
      if (value.length < 8) return "Use at least 8 characters.";
      if (value.length > 128) return "Use at most 128 characters.";
      if (!/[A-Z]/.test(value)) return "Add an uppercase letter (A–Z).";
      if (!/[a-z]/.test(value)) return "Add a lowercase letter (a–z).";
      if (!/\d/.test(value)) return "Add a number (0–9).";
      if (!/[^A-Za-z0-9]/.test(value)) return "Add a special character (anything other than A–Z, a–z or 0–9).";
      return "";
    }

    function validate() {
      const error = passwordError(password.value);
      const matches = password.value === confirm.value && confirm.value.length > 0;
      feedback.textContent = password.value ? (error || "Password meets all requirements.") : "";
      match.textContent = confirm.value ? (matches ? "Passwords match." : "Passwords do not match yet.") : "";
      password.setAttribute("aria-invalid", String(Boolean(password.value && error)));
      confirm.setAttribute("aria-invalid", String(Boolean(confirm.value && !matches)));
      submit.disabled = loading || !token || Boolean(error) || !matches;
      return !error && matches;
    }

    function endLink(message) {
      token = "";
      password.value = "";
      confirm.value = "";
      form.hidden = true;
      status.textContent = message;
      status.focus();
    }

    if (!token) {
      endLink("This reset link is missing its token. Open Northstar in your extension and request a new password reset email from the sign-in screen.");
      return;
    }

    form.hidden = false;
    status.textContent = "";
    password.addEventListener("input", validate);
    confirm.addEventListener("input", validate);
    document.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.getAttribute("aria-controls"));
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.setAttribute("aria-pressed", String(visible));
        button.textContent = visible ? "Hide" : "Show";
        button.setAttribute("aria-label", (visible ? "Hide " : "Show ") + button.dataset.toggle);
      });
    });
    validate();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (loading || !token || !validate()) return;
      loading = true;
      fields.disabled = true;
      submit.disabled = true;
      submit.textContent = "Resetting password…";
      form.setAttribute("aria-busy", "true");
      status.textContent = "Resetting your password…";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch("/api/auth/reset-password", {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password: password.value }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (response.ok && result && result.success === true) {
          document.getElementById("heading").textContent = "Password reset";
          document.getElementById("intro").textContent = "Your new password is ready.";
          endLink("Your password has been reset. Return to the Northstar extension and sign in with your new password. You have not been signed in automatically.");
        } else if (response.status === 400 && result && result.error === "Invalid or expired reset token") {
          endLink("This reset link has expired or has already been used. Return to the Northstar extension and request a new reset email from the sign-in screen.");
        } else if (response.status === 429) {
          status.textContent = "Too many attempts. Please wait a little, then try again.";
        } else {
          status.textContent = "We could not reset your password. Please try again. If this continues, request a new reset email in the Northstar extension.";
        }
      } catch {
        status.textContent = "We could not reach Northstar. Check your connection and try again. If your password was already changed, sign in or request a new reset email.";
      } finally {
        clearTimeout(timeout);
        loading = false;
        fields.disabled = false;
        submit.textContent = "Reset password";
        form.setAttribute("aria-busy", "false");
        validate();
      }
    });
  });
})();
`;

const style = `
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #fff; background: #0b1020; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100svh; display: grid; place-items: center; padding: 32px 16px;
    background: radial-gradient(ellipse at 15% 0%, #1a2247, transparent 65%), radial-gradient(ellipse at 100% 100%, #32204d, transparent 60%), #0b1020; }
  main { width: min(100%, 860px); display: grid; grid-template-columns: .85fr 1fr; border: 1px solid rgba(255,255,255,.18); border-radius: 24px;
    background: rgba(15,23,42,.85); backdrop-filter: blur(24px); box-shadow: 0 24px 80px #0008, inset 0 1px 0 #ffffff1f; overflow: hidden; }
  aside { padding: 40px 32px; background: linear-gradient(140deg, #6366f12b, #8b5cf614, transparent); border-right: 1px solid #ffffff1a; display: flex; flex-direction: column; justify-content: space-between; gap: 48px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 750; letter-spacing: -.5px; }
  .compass { color: #a5b4fc; font-size: 32px; line-height: 1; }
  .tagline { font-size: 28px; font-weight: 750; line-height: 1.25; letter-spacing: -.6px; }
  .muted, .intro, .hint, footer { color: #c4cadb; line-height: 1.6; font-size: 14px; }
  .security { color: #a7f3d0; font-size: 13px; border-top: 1px solid #ffffff1a; padding-top: 20px; }
  .content { padding: 40px 32px; min-width: 0; }
  .mobile-brand { display: none; }
  .eyebrow { color: #a5b4fc; text-transform: uppercase; letter-spacing: 1.6px; font-size: 11px; font-weight: 700; margin: 0 0 10px; }
  h1 { font-size: 27px; letter-spacing: -.6px; line-height: 1.2; margin: 0; }
  .intro { margin: 12px 0 24px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .input-row { display: flex; border: 1px solid #ffffff38; border-radius: 12px; background: #ffffff0a; overflow: hidden; }
  .input-row:focus-within { border-color: #a5b4fc; }
  input { width: 100%; min-width: 0; padding: 13px 12px; border: 0; background: transparent; color: #fff; font: inherit; font-size: 16px; }
  button { font: inherit; cursor: pointer; }
  .toggle { border: 0; background: transparent; color: #c7d2fe; padding: 12px; font-size: 13px; min-width: 62px; }
  .toggle:hover { background: #ffffff0a; }
  .hint { font-size: 12px; margin: 10px 0; }
  .feedback { font-size: 12px; line-height: 1.5; color: #c7d2fe; min-height: 18px; margin: 6px 0 16px; }
  #submit { width: 100%; min-height: 48px; padding: 12px 16px; border: 1px solid #a5b4fc66; border-radius: 12px;
    background: linear-gradient(100deg, #4f46e5, #7c3aed); color: white; font-weight: 700; transition: filter .15s; }
  #submit:hover:not(:disabled) { filter: brightness(1.15); }
  button:disabled { cursor: not-allowed; opacity: .6; }
  :focus-visible { outline: 3px solid #c7d2fe; outline-offset: 3px; }
  input:focus-visible { outline-offset: -4px; border-radius: 10px; }
  #status { font-size: 14px; line-height: 1.6; color: #e0e7ff; overflow-wrap: anywhere; }
  #status:not(:empty) { padding: 14px; border: 1px solid #818cf84d; border-radius: 12px; background: #6366f117; margin-top: 18px; }
  footer { border-top: 1px solid #ffffff1a; padding-top: 18px; margin-top: 24px; font-size: 12px; }
  [hidden] { display: none !important; }
  @media (max-width: 680px) {
    main { display: block; max-width: 460px; }
    aside { display: none; }
    .mobile-brand { display: flex; margin-bottom: 32px; }
    .content { padding: 28px 22px; }
    h1 { font-size: 25px; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;

/** Serves only the reset UI: GET never validates or consumes a reset token. */
export function resetPasswordPage(_req: Request, res: Response): void {
  const nonce = randomBytes(18).toString("base64");
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  res.status(200).type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Reset your password · Northstar</title>
  <script nonce="${nonce}">${script}</script>
  <style nonce="${nonce}">${style}</style>
</head>
<body>
  <main>
    <aside aria-label="Northstar">
      <div>
        <div class="brand"><span class="compass" aria-hidden="true">✧</span> Northstar</div>
        <p class="tagline">Your Personal<br>Command Center.</p>
        <p class="muted">A fresh start for your daily browser workflow.</p>
      </div>
      <div class="security">A secure reset. A new direction.</div>
    </aside>
    <section class="content" aria-labelledby="heading">
      <div class="brand mobile-brand"><span class="compass" aria-hidden="true">✧</span> Northstar</div>
      <p class="eyebrow">Account recovery</p>
      <h1 id="heading">Set a new password</h1>
      <p class="intro" id="intro">Choose a strong password to get back to your Northstar.</p>
      <noscript><p>JavaScript is required to securely reset your password. Enable it and reopen the link from your reset email.</p></noscript>
      <form id="reset-form" hidden>
        <fieldset id="fields">
          <legend hidden>New password</legend>
          <label for="password">New password</label>
          <div class="input-row">
            <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" aria-describedby="requirements password-feedback" spellcheck="false" autocapitalize="none">
            <button class="toggle" type="button" data-toggle="new password" aria-label="Show new password" aria-controls="password" aria-pressed="false">Show</button>
          </div>
          <p class="hint" id="requirements">Use 8–128 characters with an uppercase letter (A–Z), a lowercase letter (a–z), a number (0–9), and a special character (anything other than A–Z, a–z or 0–9).</p>
          <p class="feedback" id="password-feedback" aria-live="polite" aria-atomic="true"></p>
          <label for="confirm">Confirm new password</label>
          <div class="input-row">
            <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="128" aria-describedby="confirm-feedback" spellcheck="false" autocapitalize="none">
            <button class="toggle" type="button" data-toggle="confirmation password" aria-label="Show confirmation password" aria-controls="confirm" aria-pressed="false">Show</button>
          </div>
          <p class="feedback" id="confirm-feedback" aria-live="polite" aria-atomic="true"></p>
          <button id="submit" type="submit" disabled>Reset password</button>
        </fieldset>
      </form>
      <p id="status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></p>
      <footer>After resetting, return to the Northstar extension to sign in. This page will not sign you in automatically.</footer>
    </section>
  </main>
</body>
</html>`);
}
