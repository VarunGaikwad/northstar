import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";

function limitKey(scope: string, value: string): string {
  return `${scope}:${createHmac("sha256", env.JWT_SECRET).update(value).digest("hex")}`;
}

function requesterIp(req: Request): string {
  // Vercel overwrites this platform header; generic forwarding headers are untrusted.
  const vercelIp = process.env.VERCEL === "1" ? req.get("x-vercel-forwarded-for")?.trim() : undefined;
  return vercelIp && isIP(vercelIp) ? vercelIp : (req.socket.remoteAddress ?? "unknown");
}

async function consumeLimit(id: string, limit: number): Promise<number> {
  const [result] = await prisma.$queryRaw<{ count: number; retryAfter: number }[]>(Prisma.sql`
    WITH consumed AS (
      INSERT INTO "PasswordResetLimit" ("id", "count", "expiresAt")
      VALUES (${id}, 1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 minutes')
      ON CONFLICT ("id") DO UPDATE SET
        "count" = CASE
          WHEN "PasswordResetLimit"."expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 1
          ELSE LEAST("PasswordResetLimit"."count", ${limit}) + 1
        END,
        "expiresAt" = CASE
          WHEN "PasswordResetLimit"."expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 minutes'
          ELSE "PasswordResetLimit"."expiresAt"
        END
      RETURNING "count", "expiresAt"
    )
    SELECT "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM
      ("expiresAt" - (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))))::int AS "retryAfter"
    FROM consumed
  `);
  if (!result) throw new Error("Missing password reset limit result");
  return result.count > limit ? result.retryAfter : 0;
}

async function limitPasswordRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  scope: "forgot" | "reset",
): Promise<void> {
  try {
    // Check IP first so one requester cannot exhaust arbitrary email budgets after its own limit.
    let retryAfter = await consumeLimit(limitKey(`${scope}-ip`, requesterIp(req)), 10);
    if (!retryAfter && scope === "forgot") {
      retryAfter = await consumeLimit(limitKey("forgot-email", (req.body as { email: string }).email.toLowerCase()), 3);
    }
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      next(new ApiError("Too many requests. Please try again later.", 429));
      return;
    }
    next();
  } catch {
    // A database outage must not turn into an unlimited mail/token endpoint.
    res.setHeader("Retry-After", "60");
    next(new ApiError("Unable to process request. Please try again later.", 503));
  }
}

// Mount after validate(forgotPasswordSchema), before the controller (including unknown emails).
export function limitForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  return limitPasswordRequest(req, res, next, "forgot");
}

// Mount after validate(resetPasswordSchema), before the controller; never key on a reset token.
export function limitResetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  return limitPasswordRequest(req, res, next, "reset");
}
