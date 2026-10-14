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
  const resetLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  if (!transporter) {
    console.log("\n[DEV] No SMTP config found. Password reset email not sent.");
    console.log(`To: ${to}`);
    console.log(`Reset link: ${resetLink}\n`);
    return;
  }

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: "Reset your Northstar password",
    text: `Reset your password by clicking this link: ${resetLink}`,
    html: `<p>Reset your password by clicking <a href="${resetLink}">here</a>.</p>`,
  });
}
