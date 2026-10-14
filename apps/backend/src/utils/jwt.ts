import jwt, { type VerifyOptions } from "jsonwebtoken";
import { env } from "../config/env";

export const JWT_ISSUER = "northstar-api";
export const ACCESS_TOKEN_AUDIENCE = "northstar-access";
export const REFRESH_TOKEN_AUDIENCE = "northstar-refresh";

type RoleClaim = "USER" | "ADMIN";

export type ModernAccessTokenPayload = {
  kind: "modern";
  userId: string;
  email: string;
  role: RoleClaim;
  sessionId: string;
};

export type LegacyAccessTokenPayload = {
  kind: "legacy";
  userId: string;
  email: string;
  role: RoleClaim;
};

export type AccessTokenPayload = ModernAccessTokenPayload | LegacyAccessTokenPayload;

export type RefreshTokenPayload = {
  userId: string;
  sessionId: string;
  refreshVersion: number;
  issuedAt: Date;
  expiresAt: Date;
};

export type SignedAccessToken = {
  token: string;
  expiresAt: Date;
};

const MODERN_ACCESS_KEYS = new Set([
  "userId",
  "email",
  "role",
  "sessionId",
  "tokenType",
  "iat",
  "exp",
  "iss",
  "aud",
]);
const LEGACY_ACCESS_KEYS = new Set(["userId", "email", "role", "iat", "exp"]);
const REFRESH_KEYS = new Set(["sub", "sid", "ver", "tokenType", "iat", "exp", "iss", "aud"]);
const MODERN_MARKERS = ["sessionId", "tokenType", "iss", "aud", "sub", "sid", "ver"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isRole(value: unknown): value is RoleClaim {
  return value === "USER" || value === "ADMIN";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasValidTimes(payload: Record<string, unknown>): payload is Record<string, unknown> & {
  iat: number;
  exp: number;
} {
  return isPositiveInteger(payload.iat) && isPositiveInteger(payload.exp) && payload.exp > payload.iat;
}

function tokenSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function verifyOptions(audience: string, now: Date): VerifyOptions {
  return {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience,
    clockTimestamp: tokenSeconds(now),
  };
}

export function signAccessToken(
  payload: { userId: string; email: string; role: RoleClaim; sessionId: string },
  now = new Date(),
  notAfter?: Date,
): SignedAccessToken {
  const issuedAt = tokenSeconds(now);
  const configuredExpiresAt = issuedAt + Math.floor(env.JWT_EXPIRES_IN_MS / 1000);
  const expiresAt = notAfter
    ? Math.min(configuredExpiresAt, tokenSeconds(notAfter))
    : configuredExpiresAt;
  if (expiresAt <= issuedAt) {
    throw new Error("Access token expiry must be after issuance");
  }
  const token = jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sessionId,
      tokenType: "access",
      iat: issuedAt,
      exp: expiresAt,
    },
    env.JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    },
  );

  return { token, expiresAt: new Date(expiresAt * 1000) };
}

export function verifyAccessToken(token: string, now = new Date()): AccessTokenPayload {
  const unverified = jwt.decode(token);
  const isModern = isRecord(unverified) && MODERN_MARKERS.some((key) => key in unverified);

  if (isModern) {
    const verified = jwt.verify(
      token,
      env.JWT_SECRET,
      verifyOptions(ACCESS_TOKEN_AUDIENCE, now),
    );
    if (
      !isRecord(verified) ||
      !hasExactKeys(verified, MODERN_ACCESS_KEYS) ||
      verified.tokenType !== "access" ||
      verified.iss !== JWT_ISSUER ||
      verified.aud !== ACCESS_TOKEN_AUDIENCE ||
      typeof verified.userId !== "string" ||
      !verified.userId ||
      typeof verified.email !== "string" ||
      !verified.email ||
      !isRole(verified.role) ||
      typeof verified.sessionId !== "string" ||
      !verified.sessionId ||
      !hasValidTimes(verified)
    ) {
      throw new jwt.JsonWebTokenError("Invalid access token claims");
    }

    return {
      kind: "modern",
      userId: verified.userId,
      email: verified.email,
      role: verified.role,
      sessionId: verified.sessionId,
    };
  }

  const verified = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    clockTimestamp: tokenSeconds(now),
  });
  if (
    !isRecord(verified) ||
    !hasExactKeys(verified, LEGACY_ACCESS_KEYS) ||
    typeof verified.userId !== "string" ||
    !verified.userId ||
    typeof verified.email !== "string" ||
    !verified.email ||
    !isRole(verified.role) ||
    !hasValidTimes(verified)
  ) {
    throw new jwt.JsonWebTokenError("Invalid legacy access token claims");
  }

  return {
    kind: "legacy",
    userId: verified.userId,
    email: verified.email,
    role: verified.role,
  };
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const issuedAt = tokenSeconds(payload.issuedAt);
  const expiresAt = tokenSeconds(payload.expiresAt);
  if (expiresAt <= issuedAt) {
    throw new Error("Refresh token expiry must be after issuance");
  }

  return jwt.sign(
    {
      sub: payload.userId,
      sid: payload.sessionId,
      ver: payload.refreshVersion,
      tokenType: "refresh",
      iat: issuedAt,
      exp: expiresAt,
    },
    env.JWT_REFRESH_SECRET,
    {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: REFRESH_TOKEN_AUDIENCE,
    },
  );
}

export function verifyRefreshToken(token: string, now = new Date()): RefreshTokenPayload {
  const verified = jwt.verify(
    token,
    env.JWT_REFRESH_SECRET,
    verifyOptions(REFRESH_TOKEN_AUDIENCE, now),
  );
  if (
    !isRecord(verified) ||
    !hasExactKeys(verified, REFRESH_KEYS) ||
    verified.tokenType !== "refresh" ||
    verified.iss !== JWT_ISSUER ||
    verified.aud !== REFRESH_TOKEN_AUDIENCE ||
    typeof verified.sub !== "string" ||
    !verified.sub ||
    typeof verified.sid !== "string" ||
    !verified.sid ||
    !isPositiveInteger(verified.ver) ||
    !hasValidTimes(verified)
  ) {
    throw new jwt.JsonWebTokenError("Invalid refresh token claims");
  }

  return {
    userId: verified.sub,
    sessionId: verified.sid,
    refreshVersion: verified.ver,
    issuedAt: new Date(verified.iat * 1000),
    expiresAt: new Date(verified.exp * 1000),
  };
}
