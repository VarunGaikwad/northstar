import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env";

export const REFRESH_COOKIE_NAME = "northstar_refresh_token";

function useLocalDevelopmentCookie(req: Request | undefined): boolean {
  if (!req) return false;
  const hostname = req.hostname;
  return (
    env.NODE_ENV === "development" &&
    env.CHROME_EXTENSION_ORIGINS.length === 0 &&
    !req.secure &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]")
  );
}

export function getRefreshCookieBaseOptions(req?: Request): CookieOptions {
  const localDevelopment = useLocalDevelopmentCookie(req);
  return {
    httpOnly: true,
    secure: !localDevelopment,
    sameSite: localDevelopment ? "lax" : "none",
    path: "/",
  };
}

export function getRefreshCookieOptions(
  expiresAt: Date,
  now = new Date(),
  req?: Request,
): CookieOptions {
  return {
    ...getRefreshCookieBaseOptions(req),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  };
}

export function setRefreshCookie(
  req: Request,
  res: Response,
  token: string,
  expiresAt: Date,
  now = new Date(),
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOptions(expiresAt, now, req));
}

export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieBaseOptions(req));
}

export function getRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === "string" && value ? value : undefined;
}
