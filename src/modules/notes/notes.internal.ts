import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { runNotesCleanup } from "./notes.cleanup";

function unauthorized(): ApiError {
  return new ApiError("Unauthorized", 401);
}

function getSingleAuthorizationHeader(req: Request): string | null {
  if (Array.isArray(req.rawHeaders) && req.rawHeaders.length > 0) {
    const authorizationHeaders: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === "authorization") {
        const value = req.rawHeaders[index + 1];
        if (value !== undefined) authorizationHeaders.push(value);
      }
    }
    if (authorizationHeaders.length !== 1) return null;
    return authorizationHeaders[0] ?? null;
  }

  const authorization = req.headers.authorization;
  return typeof authorization === "string" ? authorization : null;
}

function getBearerSecret(req: Request): string | null {
  const authorization = getSingleAuthorizationHeader(req);
  if (authorization === null) return null;
  return /^Bearer (\S+)$/.exec(authorization)?.[1] ?? null;
}

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function authenticateNotesCleanup(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const suppliedSecret = getBearerSecret(req);
  if (suppliedSecret === null) {
    next(unauthorized());
    return;
  }

  let authorized = false;
  try {
    const expectedDigest = hashSecret(env.CRON_SECRET);
    const suppliedDigest = hashSecret(suppliedSecret);
    authorized =
      expectedDigest.length === suppliedDigest.length &&
      timingSafeEqual(expectedDigest, suppliedDigest);
  } catch {
    authorized = false;
  }

  if (!authorized) {
    next(unauthorized());
    return;
  }
  next();
}

export async function cleanupNotes(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await runNotesCleanup();
  res.status(200).json({ success: true, data: result });
}
