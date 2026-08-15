import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import {
  ACCESS_TOKEN_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_AUDIENCE,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./jwt";

const now = new Date("2026-08-15T00:00:00.000Z");
const issuedAt = Math.floor(now.getTime() / 1000);

function signModernAccess(
  overrides: Record<string, unknown> = {},
  options: { algorithm?: "HS256" | "HS384"; issuer?: string; audience?: string } = {},
): string {
  return jwt.sign(
    {
      userId: "user-a",
      email: "user@example.com",
      role: "USER",
      sessionId: "session-a",
      tokenType: "access",
      iat: issuedAt,
      exp: issuedAt + 900,
      ...overrides,
    },
    env.JWT_SECRET,
    {
      algorithm: options.algorithm ?? "HS256",
      issuer: options.issuer ?? JWT_ISSUER,
      audience: options.audience ?? ACCESS_TOKEN_AUDIENCE,
    },
  );
}

test("issues and verifies strict modern access claims", () => {
  const signed = signAccessToken(
    {
      userId: "user-a",
      email: "user@example.com",
      role: "ADMIN",
      sessionId: "session-a",
    },
    now,
  );
  const decoded = jwt.decode(signed.token);

  assert.equal(signed.expiresAt.getTime() - now.getTime(), env.JWT_EXPIRES_IN_MS);
  assert.ok(decoded && typeof decoded === "object");
  assert.equal(decoded.tokenType, "access");
  assert.equal(decoded.iss, JWT_ISSUER);
  assert.equal(decoded.aud, ACCESS_TOKEN_AUDIENCE);
  assert.deepEqual(verifyAccessToken(signed.token, now), {
    kind: "modern",
    userId: "user-a",
    email: "user@example.com",
    role: "ADMIN",
    sessionId: "session-a",
  });
  assert.throws(() => verifyAccessToken(signed.token, signed.expiresAt));
});

test("rejects wrong modern algorithm, type, issuer, audience, and shape", () => {
  assert.throws(() => verifyAccessToken(signModernAccess({}, { algorithm: "HS384" }), now));
  assert.throws(() => verifyAccessToken(signModernAccess({ tokenType: "refresh" }), now));
  assert.throws(() => verifyAccessToken(signModernAccess({}, { issuer: "other-api" }), now));
  assert.throws(() => verifyAccessToken(signModernAccess({}, { audience: "other-client" }), now));
  assert.throws(() =>
    verifyAccessToken(
      signModernAccess({ sessionId: undefined }),
      now,
    ),
  );
});

test("accepts only the exact legacy access-token shape through embedded expiry", () => {
  const token = jwt.sign(
    {
      userId: "legacy-user",
      email: "legacy@example.com",
      role: "USER",
      iat: issuedAt,
      exp: issuedAt + 60,
    },
    env.JWT_SECRET,
    { algorithm: "HS256" },
  );

  assert.deepEqual(verifyAccessToken(token, now), {
    kind: "legacy",
    userId: "legacy-user",
    email: "legacy@example.com",
    role: "USER",
  });
  assert.throws(() => verifyAccessToken(token, new Date((issuedAt + 60) * 1000)));

  const malformedModern = jwt.sign(
    {
      userId: "legacy-user",
      email: "legacy@example.com",
      role: "USER",
      tokenType: "access",
      iat: issuedAt,
      exp: issuedAt + 60,
    },
    env.JWT_SECRET,
    { algorithm: "HS256" },
  );
  assert.throws(() => verifyAccessToken(malformedModern, now));
});

test("refresh tokens are deterministic, strictly verified, and cannot authenticate APIs", () => {
  const payload = {
    userId: "user-a",
    sessionId: "session-a",
    refreshVersion: 3,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
  const first = signRefreshToken(payload);
  const second = signRefreshToken(payload);
  const decoded = jwt.decode(first);

  assert.equal(first, second);
  assert.ok(decoded && typeof decoded === "object");
  assert.equal(decoded.tokenType, "refresh");
  assert.equal(decoded.aud, REFRESH_TOKEN_AUDIENCE);
  assert.deepEqual(verifyRefreshToken(first, now), payload);
  assert.throws(() => verifyAccessToken(first, now));
});

test("rejects refresh JWTs with wrong algorithm, type, issuer, or audience", () => {
  const baseClaims = {
    sub: "user-a",
    sid: "session-a",
    ver: 0,
    tokenType: "refresh",
    iat: issuedAt,
    exp: issuedAt + 60,
  };
  const sign = (
    overrides: Record<string, unknown>,
    options: { algorithm?: "HS256" | "HS384"; issuer?: string; audience?: string } = {},
  ) =>
    jwt.sign({ ...baseClaims, ...overrides }, env.JWT_REFRESH_SECRET, {
      algorithm: options.algorithm ?? "HS256",
      issuer: options.issuer ?? JWT_ISSUER,
      audience: options.audience ?? REFRESH_TOKEN_AUDIENCE,
    });

  assert.throws(() => verifyRefreshToken(sign({}, { algorithm: "HS384" }), now));
  assert.throws(() => verifyRefreshToken(sign({ tokenType: "access" }), now));
  assert.throws(() => verifyRefreshToken(sign({}, { issuer: "other-api" }), now));
  assert.throws(() => verifyRefreshToken(sign({}, { audience: "other-client" }), now));
});
