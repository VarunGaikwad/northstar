import crypto from "crypto";
import { Prisma, type AuthSession, type User } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { sendPasswordResetEmail } from "../../utils/email";
import { comparePassword, hashPassword } from "../../utils/hash";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from "../../utils/jwt";
import type { AuthResult, SafeUser } from "./auth.types";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60;
const REFRESH_RACE_GRACE_MS = 10 * 1000;

type SessionWithUser = AuthSession & { user: User };

function sanitizeUser(user: User): SafeUser {
  const {
    passwordHash: _passwordHash,
    resetToken: _resetToken,
    resetTokenExpiresAt: _resetTokenExpiresAt,
    ...safeUser
  } = user;
  return safeUser;
}

function canonicalTime(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 1000) * 1000);
}

function minDate(first: Date, second: Date): Date {
  return first <= second ? first : second;
}

function refreshExpiry(session: AuthSession): Date {
  return minDate(session.idleExpiresAt, session.absoluteExpiresAt);
}

function invalidRefreshSession(): ApiError {
  return new ApiError("Invalid or expired refresh session", 401);
}

function buildAuthResult(user: User, session: AuthSession, now: Date): AuthResult {
  const access = signAccessToken(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    },
    now,
    session.absoluteExpiresAt,
  );
  const refreshTokenExpiresAt = refreshExpiry(session);
  const refreshToken = signRefreshToken({
    userId: user.id,
    sessionId: session.id,
    refreshVersion: session.refreshVersion,
    issuedAt: session.refreshIssuedAt,
    expiresAt: refreshTokenExpiresAt,
  });

  return {
    data: {
      user: sanitizeUser(user),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      session: {
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    },
    refreshToken,
    refreshTokenExpiresAt,
  };
}

async function createSession(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<AuthSession> {
  const createdAt = canonicalTime(now);
  const absoluteExpiresAt = new Date(
    createdAt.getTime() + env.AUTH_SESSION_ABSOLUTE_EXPIRES_IN_MS,
  );
  const idleExpiresAt = minDate(
    new Date(createdAt.getTime() + env.AUTH_SESSION_IDLE_EXPIRES_IN_MS),
    absoluteExpiresAt,
  );

  return tx.authSession.create({
    data: {
      userId,
      refreshVersion: 0,
      refreshIssuedAt: createdAt,
      lastUsedAt: createdAt,
      idleExpiresAt,
      absoluteExpiresAt,
      createdAt,
    },
  });
}

async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
}

async function deleteStaleSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  const longRevokedBefore = new Date(now.getTime() - env.AUTH_SESSION_IDLE_EXPIRES_IN_MS);
  await tx.authSession.deleteMany({
    where: {
      userId,
      OR: [
        { idleExpiresAt: { lte: now } },
        { absoluteExpiresAt: { lte: now } },
        { revokedAt: { lte: longRevokedBefore } },
      ],
    },
  });
}

function sessionIsUsable(session: SessionWithUser, userId: string, now: Date): boolean {
  return (
    session.userId === userId &&
    session.user.id === userId &&
    session.user.isActive &&
    session.revokedAt === null &&
    session.idleExpiresAt > now &&
    session.absoluteExpiresAt > now
  );
}

async function revokeReusedSession(session: AuthSession, now: Date): Promise<never> {
  await prisma.authSession.updateMany({
    where: { id: session.id, userId: session.userId, revokedAt: null },
    data: { revokedAt: now },
  });
  throw invalidRefreshSession();
}

async function handleRefreshVersionMismatch(
  session: SessionWithUser,
  claims: RefreshTokenPayload,
  now: Date,
  previouslyCurrent = false,
): Promise<AuthResult> {
  const rotationAge = now.getTime() - session.refreshIssuedAt.getTime();
  const immediatePreviousGeneration =
    claims.refreshVersion === session.refreshVersion - 1 &&
    rotationAge >= 0 &&
    rotationAge <= REFRESH_RACE_GRACE_MS;
  const advancedDuringRequest =
    previouslyCurrent &&
    session.refreshVersion > claims.refreshVersion &&
    session.refreshIssuedAt.getTime() >= now.getTime() &&
    session.refreshIssuedAt.getTime() - now.getTime() <= REFRESH_RACE_GRACE_MS;
  if (immediatePreviousGeneration || advancedDuringRequest) {
    return buildAuthResult(session.user, session, now);
  }

  return revokeReusedSession(session, now);
}

export async function register(
  data: { email: string; password: string; firstName: string; lastName: string },
  now = new Date(),
): Promise<AuthResult> {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingUser) {
    throw new ApiError("An account with this email already exists", 409);
  }

  const passwordHash = await hashPassword(data.password);
  const issuedAt = canonicalTime(now);
  const { user, session } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });
    const session = await createSession(tx, user.id, issuedAt);
    return { user, session };
  });

  return buildAuthResult(user, session, issuedAt);
}

export async function login(
  data: { email: string; password: string },
  now = new Date(),
): Promise<AuthResult> {
  const issuedAt = canonicalTime(now);
  const { user, session } = await prisma.$transaction(async (tx) => {
    const candidate = await tx.user.findUnique({ where: { email: data.email } });
    if (!candidate) {
      throw new ApiError("Invalid email or password", 401);
    }

    await lockUser(tx, candidate.id);
    const user = await tx.user.findUnique({ where: { id: candidate.id } });
    if (!user) {
      throw new ApiError("Invalid email or password", 401);
    }
    if (!user.isActive) {
      throw new ApiError("Account is deactivated", 403);
    }

    const isPasswordValid = await comparePassword(data.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new ApiError("Invalid email or password", 401);
    }

    await deleteStaleSessions(tx, user.id, issuedAt);
    const session = await createSession(tx, user.id, issuedAt);
    return { user, session };
  });
  return buildAuthResult(user, session, issuedAt);
}

export async function refresh(
  refreshToken: string | undefined,
  now = new Date(),
): Promise<AuthResult> {
  if (!refreshToken) {
    throw invalidRefreshSession();
  }

  const refreshedAt = canonicalTime(now);
  let claims: RefreshTokenPayload;
  try {
    claims = verifyRefreshToken(refreshToken, refreshedAt);
  } catch {
    throw invalidRefreshSession();
  }

  let session = await prisma.authSession.findUnique({
    where: { id: claims.sessionId },
    include: { user: true },
  });
  if (!session || !sessionIsUsable(session, claims.userId, refreshedAt)) {
    if (session?.user.id === claims.userId && !session.user.isActive && !session.revokedAt) {
      await prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: refreshedAt },
      });
    }
    throw invalidRefreshSession();
  }

  if (claims.refreshVersion !== session.refreshVersion) {
    return handleRefreshVersionMismatch(session, claims, refreshedAt);
  }
  const currentSession = session;

  const idleExpiresAt = minDate(
    new Date(refreshedAt.getTime() + env.AUTH_SESSION_IDLE_EXPIRES_IN_MS),
    currentSession.absoluteExpiresAt,
  );
  const rotation = await prisma.$transaction(async (tx) => {
    await lockUser(tx, claims.userId);
    const currentUser = await tx.user.findUnique({ where: { id: claims.userId } });
    if (!currentUser || !currentUser.isActive) {
      if (currentUser) {
        await tx.authSession.updateMany({
          where: { id: currentSession.id, userId: claims.userId, revokedAt: null },
          data: { revokedAt: refreshedAt },
        });
      }
      return { status: "invalid" as const };
    }

    const result = await tx.authSession.updateMany({
      where: {
        id: currentSession.id,
        userId: claims.userId,
        refreshVersion: claims.refreshVersion,
        revokedAt: null,
        idleExpiresAt: { gt: refreshedAt },
        absoluteExpiresAt: { gt: refreshedAt },
      },
      data: {
        refreshVersion: { increment: 1 },
        refreshIssuedAt: refreshedAt,
        lastUsedAt: refreshedAt,
        idleExpiresAt,
      },
    });
    return { status: "complete" as const, count: result.count, user: currentUser };
  });

  if (rotation.status === "invalid") {
    throw invalidRefreshSession();
  }
  if (rotation.count === 1) {
    const rotatedSession: SessionWithUser = {
      ...currentSession,
      user: rotation.user,
      refreshVersion: currentSession.refreshVersion + 1,
      refreshIssuedAt: refreshedAt,
      lastUsedAt: refreshedAt,
      idleExpiresAt,
    };
    return buildAuthResult(rotatedSession.user, rotatedSession, refreshedAt);
  }

  session = await prisma.authSession.findUnique({
    where: { id: claims.sessionId },
    include: { user: true },
  });
  if (!session || !sessionIsUsable(session, claims.userId, refreshedAt)) {
    throw invalidRefreshSession();
  }
  return handleRefreshVersionMismatch(session, claims, refreshedAt, true);
}

export async function logout(refreshToken: string | undefined, now = new Date()): Promise<void> {
  if (!refreshToken) return;

  let claims: RefreshTokenPayload;
  try {
    claims = verifyRefreshToken(refreshToken, now);
  } catch {
    return;
  }

  await prisma.authSession.updateMany({
    where: { id: claims.sessionId, userId: claims.userId, revokedAt: null },
    data: { revokedAt: canonicalTime(now) },
  });
}

export async function logoutAll(userId: string, now = new Date()): Promise<void> {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: canonicalTime(now) },
  });
}

export async function forgotPassword(data: { email: string }): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (!user) return;

  const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
  const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: rawToken, resetTokenExpiresAt },
  });

  try {
    // Await delivery acceptance so Vercel cannot suspend the pending SMTP work.
    await sendPasswordResetEmail(user.email, rawToken);
  } catch {
    // SMTP errors can contain recipients, credentials or links. Never log them.
    console.error("Password reset email delivery failed; check SMTP configuration and provider logs.");
  }
}

export async function resetPassword(
  data: { token: string; password: string },
  now = new Date(),
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { resetToken: data.token },
  });
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt <= now) {
    throw new ApiError("Invalid or expired reset token", 400);
  }

  const passwordHash = await hashPassword(data.password);
  const revokedAt = canonicalTime(now);
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, user.id);
    const currentUser = await tx.user.findUnique({ where: { id: user.id } });
    if (
      !currentUser ||
      currentUser.resetToken !== data.token ||
      !currentUser.resetTokenExpiresAt ||
      currentUser.resetTokenExpiresAt <= now
    ) {
      throw new ApiError("Invalid or expired reset token", 400);
    }

    await tx.user.update({
      where: { id: currentUser.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });
    await tx.authSession.updateMany({
      where: { userId: currentUser.id, revokedAt: null },
      data: { revokedAt },
    });
  });
}
