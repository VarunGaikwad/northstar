import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";

export function isTrustedOrigin(origin: string | undefined): boolean {
  return (
    origin === undefined ||
    origin.startsWith("chrome-extension://") ||
    env.TRUSTED_ORIGINS.includes(origin)
  );
}

export function requireTrustedAuthOrigin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!isTrustedOrigin(req.headers.origin)) {
    next(new ApiError("Origin is not allowed", 403));
    return;
  }
  next();
}
