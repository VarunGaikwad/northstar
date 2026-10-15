import nodemailer from "nodemailer";
import { env } from "../config/env";

const hasSmtpConfig = Boolean(
  env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS
);

const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: env.NODE_ENV === "production",
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    })
  : null;

export async function sendPasswordResetEmail(
  to: string,
  token: string
): Promise<void> {
  const url = new URL("/reset-password", env.PUBLIC_BACKEND_URL);
  url.searchParams.set("token", token);
  const resetLink = url.toString();

  if (!transporter) {
    if (env.NODE_ENV === "production") {
      throw new Error("Password reset SMTP is not configured");
    }
    console.log("\n[DEV] No SMTP config found. Password reset email not sent.");
    console.log(`To: ${to}`);
    console.log(`Reset link: ${resetLink}\n`);
    return;
  }

  const htmlLink = resetLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const info = await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: "Reset your Northstar password",
    text: `Reset your Northstar password: ${resetLink}\n\nThis link expires in one hour and can only be used once. Only the latest reset link works. If you didn't request this, ignore this email; your password has not changed. After resetting, return to the Northstar extension and sign in.`,
    html: `<h1>Reset your Northstar password</h1><p>Choose a new password securely.</p><p><a href="${htmlLink}">Reset password</a></p><p>This link expires in one hour and can only be used once. Only the latest reset link works.</p><p>If you didn't request this, ignore this email; your password has not changed.</p><p>After resetting, return to the Northstar extension and sign in.</p>`,
  });
  if (info.rejected?.length) {
    throw new Error("Password reset recipient rejected by SMTP");
  }
}
