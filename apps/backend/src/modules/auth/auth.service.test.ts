import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AuthSession, Prisma, User } from "@prisma/client";
import { hashSync } from "bcryptjs";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { signRefreshToken, verifyAccessToken, verifyRefreshToken } from "../../utils/jwt";
import { login, logout, logoutAll, refresh, register, resetPassword } from "./auth.service";

type SessionWithUser = AuthSession & { user: User };
type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>;
type SessionCreateData = Omit<AuthSession, "id" | "updatedAt" | "revokedAt">;
type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function mockPrismaMethod<F extends (...args: never[]) => unknown>(
  t: TestContext,
  target: object,
  methodName: string,
  implementation: F,
) {
  const original = Object.getOwnPropertyDescriptor(target, methodName);
  const mocked = t.mock.fn(implementation);
  Object.defineProperty(target, methodName, {
    ...original,
    configurable: true,
    value: mocked,
  });
  t.after(() => {
    if (original) {
      Object.defineProperty(target, methodName, original);
    } else {
      Reflect.deleteProperty(target, methodName);
    }
  });
  return mocked;
}

function mockCallbackTransactions(t: TestContext) {
  return mockPrismaMethod(t, prisma, "$transaction", (callback: TransactionCallback) =>
    callback(prisma as unknown as Prisma.TransactionClient),
  );
}

function mockUserLocks(t: TestContext) {
  return mockPrismaMethod(t, prisma, "$queryRaw", (_query: unknown) =>
    Promise.resolve([{ id: "user-a" }]),
  );
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-a",
    email: "user@example.com",
    passwordHash: hashSync("Password123!", 4),
    firstName: "Test",
    lastName: "User",
    role: "USER",
    isVerified: true,
    isActive: true,
    resetToken: null,
    resetTokenExpiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function session(
  id: string,
  owner: User,
  now: Date,
  overrides: Partial<AuthSession> = {},
): SessionWithUser {
  return {
    id,
    userId: owner.id,
    refreshVersion: 0,
    refreshIssuedAt: now,
    lastUsedAt: now,
    idleExpiresAt: new Date(now.getTime() + env.AUTH_SESSION_IDLE_EXPIRES_IN_MS),
    absoluteExpiresAt: new Date(now.getTime() + env.AUTH_SESSION_ABSOLUTE_EXPIRES_IN_MS),
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    user: owner,
  };
}

function refreshTokenFor(value: AuthSession): string {
  return signRefreshToken({
    userId: value.userId,
    sessionId: value.id,
    refreshVersion: value.refreshVersion,
    issuedAt: value.refreshIssuedAt,
    expiresAt:
      value.idleExpiresAt <= value.absoluteExpiresAt
        ? value.idleExpiresAt
        : value.absoluteExpiresAt,
  });
}

function mockSessionStore(
  t: TestContext,
  initial: SessionWithUser | null,
  options: { currentUser?: User; advanceTwoGenerationsOnRotate?: boolean } = {},
) {
  const store: { current: SessionWithUser | null } = { current: initial };

  mockPrismaMethod(t, prisma.authSession, "findUnique", () => {
    if (!store.current) return Promise.resolve(null);
    return Promise.resolve({ ...store.current, user: { ...store.current.user } });
  });
  mockPrismaMethod(
    t,
    prisma.authSession,
    "updateMany",
    (args: {
      where: {
        id?: string;
        userId?: string;
        refreshVersion?: number;
        revokedAt?: null;
        idleExpiresAt?: { gt: Date };
        absoluteExpiresAt?: { gt: Date };
      };
      data: {
        refreshVersion?: { increment: number };
        refreshIssuedAt?: Date;
        lastUsedAt?: Date;
        idleExpiresAt?: Date;
        revokedAt?: Date;
      };
    }) => {
      const current = store.current;
      if (
        !current ||
        (args.where.id !== undefined && args.where.id !== current.id) ||
        (args.where.userId !== undefined && args.where.userId !== current.userId) ||
        (args.where.refreshVersion !== undefined &&
          args.where.refreshVersion !== current.refreshVersion) ||
        (args.where.revokedAt === null && current.revokedAt !== null) ||
        (args.where.idleExpiresAt && current.idleExpiresAt <= args.where.idleExpiresAt.gt) ||
        (args.where.absoluteExpiresAt &&
          current.absoluteExpiresAt <= args.where.absoluteExpiresAt.gt)
      ) {
        return Promise.resolve({ count: 0 });
      }

      if (args.data.refreshVersion) {
        if (options.advanceTwoGenerationsOnRotate) {
          current.refreshVersion += 2;
          current.refreshIssuedAt = new Date(args.data.refreshIssuedAt!.getTime() + 1000);
          current.lastUsedAt = current.refreshIssuedAt;
          current.idleExpiresAt = args.data.idleExpiresAt!;
          return Promise.resolve({ count: 0 });
        }
        current.refreshVersion += args.data.refreshVersion.increment;
      }
      if (args.data.refreshIssuedAt) current.refreshIssuedAt = args.data.refreshIssuedAt;
      if (args.data.lastUsedAt) current.lastUsedAt = args.data.lastUsedAt;
      if (args.data.idleExpiresAt) current.idleExpiresAt = args.data.idleExpiresAt;
      if (args.data.revokedAt) current.revokedAt = args.data.revokedAt;
      return Promise.resolve({ count: 1 });
    },
  );
  mockPrismaMethod(t, prisma.user, "findUnique", () =>
    Promise.resolve(options.currentUser ?? store.current?.user ?? null),
  );
  mockUserLocks(t);
  mockCallbackTransactions(t);

  return store;
}

test("login creates independent sessions with access and session expiry metadata", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const storedUser = user();
  let nextSession = 0;
  mockPrismaMethod(t, prisma.user, "findUnique", () => Promise.resolve(storedUser));
  mockPrismaMethod(t, prisma.authSession, "deleteMany", () => Promise.resolve({ count: 0 }));
  mockPrismaMethod(
    t,
    prisma.authSession,
    "create",
    (args: { data: SessionCreateData }) => {
      nextSession += 1;
      return Promise.resolve({
        id: `session-${nextSession}`,
        revokedAt: null,
        updatedAt: args.data.createdAt,
        ...args.data,
      });
    },
  );
  mockUserLocks(t);
  mockCallbackTransactions(t);

  const first = await login({ email: storedUser.email, password: "Password123!" }, now);
  const second = await login({ email: storedUser.email, password: "Password123!" }, now);
  const firstAccess = verifyAccessToken(first.data.accessToken, now);
  const secondAccess = verifyAccessToken(second.data.accessToken, now);

  assert.equal(firstAccess.kind, "modern");
  assert.equal(secondAccess.kind, "modern");
  assert.notEqual(firstAccess.sessionId, secondAccess.sessionId);
  assert.equal(
    first.data.accessTokenExpiresAt.getTime() - now.getTime(),
    env.JWT_EXPIRES_IN_MS,
  );
  assert.equal(
    first.data.session.idleExpiresAt.getTime() - now.getTime(),
    env.AUTH_SESSION_IDLE_EXPIRES_IN_MS,
  );
  assert.equal(
    first.data.session.absoluteExpiresAt.getTime() - now.getTime(),
    env.AUTH_SESSION_ABSOLUTE_EXPIRES_IN_MS,
  );
});

test("registration creates the user and first session in one transaction", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const createdUser = user({ isVerified: false });
  mockPrismaMethod(t, prisma.user, "findUnique", () => Promise.resolve(null));
  mockPrismaMethod(t, prisma.user, "create", () => Promise.resolve(createdUser));
  mockPrismaMethod(t, prisma.authSession, "create", (args: { data: SessionCreateData }) =>
    Promise.resolve({ id: "session-register", revokedAt: null, updatedAt: now, ...args.data }),
  );
  const transaction = mockCallbackTransactions(t);

  const result = await register(
    {
      email: createdUser.email,
      password: "Password123!",
      firstName: "Test",
      lastName: "User",
    },
    now,
  );

  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(result.data.user.id, createdUser.id);
  assert.equal(verifyRefreshToken(result.refreshToken, now).sessionId, "session-register");
});

test("login revalidates the password after acquiring the reset serialization lock", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const beforeReset = user();
  const afterReset = user({ passwordHash: hashSync("NewPassword123!", 4) });
  let reads = 0;
  mockPrismaMethod(t, prisma.user, "findUnique", () => {
    reads += 1;
    return Promise.resolve(reads === 1 ? beforeReset : afterReset);
  });
  const deleteSessions = mockPrismaMethod(t, prisma.authSession, "deleteMany", () =>
    Promise.resolve({ count: 0 }),
  );
  const createSession = mockPrismaMethod(t, prisma.authSession, "create", () =>
    Promise.resolve(session("should-not-exist", afterReset, now)),
  );
  const lock = mockUserLocks(t);
  mockCallbackTransactions(t);

  await assert.rejects(
    login({ email: beforeReset.email, password: "Password123!" }, now),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
  assert.equal(lock.mock.callCount(), 1);
  assert.equal(deleteSessions.mock.callCount(), 0);
  assert.equal(createSession.mock.callCount(), 0);
});

test("refresh rotates once and regenerates the same current token during race grace", async (t) => {
  const startedAt = new Date("2026-08-15T00:00:00.000Z");
  const initial = session("session-a", user(), startedAt);
  const originalToken = refreshTokenFor(initial);
  const store = mockSessionStore(t, initial);

  const first = await refresh(originalToken, new Date(startedAt.getTime() + 1000));
  const raced = await refresh(originalToken, new Date(startedAt.getTime() + 2000));

  assert.equal(store.current?.refreshVersion, 1);
  assert.equal(first.refreshToken, raced.refreshToken);
  assert.equal(verifyRefreshToken(first.refreshToken, startedAt).refreshVersion, 1);
  assert.equal(
    first.data.session.idleExpiresAt.getTime(),
    startedAt.getTime() + 1000 + env.AUTH_SESSION_IDLE_EXPIRES_IN_MS,
  );
});

test("refresh signs access claims from the user row locked with rotation", async (t) => {
  const startedAt = new Date("2026-08-15T00:00:00.000Z");
  const staleUser = user({ email: "old@example.com", role: "ADMIN" });
  const currentUser = user({ email: "current@example.com", role: "USER" });
  const initial = session("session-claims", staleUser, startedAt);
  const token = refreshTokenFor(initial);
  mockSessionStore(t, initial, { currentUser });

  const result = await refresh(token, new Date(startedAt.getTime() + 1000));
  const access = verifyAccessToken(result.data.accessToken, startedAt);

  assert.equal(result.data.user.email, "current@example.com");
  assert.equal(result.data.user.role, "USER");
  assert.equal(access.email, "current@example.com");
  assert.equal(access.role, "USER");
});

test("a request observed as current does not revoke after a two-generation race", async (t) => {
  const startedAt = new Date("2026-08-15T00:00:00.000Z");
  const initial = session("session-multirace", user(), startedAt);
  const token = refreshTokenFor(initial);
  const store = mockSessionStore(t, initial, { advanceTwoGenerationsOnRotate: true });

  const result = await refresh(token, new Date(startedAt.getTime() + 1000));

  assert.equal(store.current?.refreshVersion, 2);
  assert.equal(store.current?.revokedAt, null);
  assert.equal(verifyRefreshToken(result.refreshToken, startedAt).refreshVersion, 2);
});

test("refresh idle extension never passes the absolute session cap", async (t) => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const absoluteExpiresAt = new Date(
    createdAt.getTime() + env.AUTH_SESSION_ABSOLUTE_EXPIRES_IN_MS,
  );
  const refreshedAt = new Date(absoluteExpiresAt.getTime() - 1000);
  const initial = session("session-cap", user(), createdAt, {
    refreshIssuedAt: new Date(refreshedAt.getTime() - 1000),
    idleExpiresAt: absoluteExpiresAt,
    absoluteExpiresAt,
  });
  const token = refreshTokenFor(initial);
  mockSessionStore(t, initial);

  const result = await refresh(token, refreshedAt);

  assert.equal(result.data.session.idleExpiresAt.getTime(), absoluteExpiresAt.getTime());
  assert.equal(result.refreshTokenExpiresAt.getTime(), absoluteExpiresAt.getTime());
  assert.equal(result.data.accessTokenExpiresAt.getTime(), absoluteExpiresAt.getTime());
  assert.throws(() => verifyAccessToken(result.data.accessToken, absoluteExpiresAt));
});

test("reuse outside race grace revokes the represented session", async (t) => {
  const rotatedAt = new Date("2026-08-15T00:00:01.000Z");
  const current = session("session-reused", user(), rotatedAt, {
    refreshVersion: 1,
    refreshIssuedAt: rotatedAt,
  });
  const oldToken = signRefreshToken({
    userId: current.userId,
    sessionId: current.id,
    refreshVersion: 0,
    issuedAt: new Date(rotatedAt.getTime() - 1000),
    expiresAt: current.idleExpiresAt,
  });
  const store = mockSessionStore(t, current);

  await assert.rejects(
    refresh(oldToken, new Date(rotatedAt.getTime() + 11_000)),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
  assert.equal(store.current?.revokedAt?.toISOString(), "2026-08-15T00:00:12.000Z");
});

test("missing, malformed, and inactive-user refreshes return generic 401", async (t) => {
  await assert.rejects(refresh(undefined), /Invalid or expired refresh session/);
  await assert.rejects(refresh("not-a-jwt"), /Invalid or expired refresh session/);

  const now = new Date("2026-08-15T00:00:00.000Z");
  const inactive = session("session-inactive", user({ isActive: false }), now);
  const token = refreshTokenFor(inactive);
  const store = mockSessionStore(t, inactive);
  await assert.rejects(refresh(token, now), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, "Invalid or expired refresh session");
    return true;
  });
  assert.equal(store.current?.revokedAt?.getTime(), now.getTime());
});

test("refresh database failures remain server errors instead of auth failures", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const initial = session("session-db", user(), now);
  const token = refreshTokenFor(initial);
  const databaseError = new Error("database unavailable");
  mockPrismaMethod(t, prisma.authSession, "findUnique", () => Promise.reject(databaseError));

  await assert.rejects(refresh(token, now), (error: unknown) => error === databaseError);
});

test("current logout targets one session while logout-all targets every user session", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const firstSession = session("session-one", user(), now);
  const updateMany = mockPrismaMethod(t, prisma.authSession, "updateMany", (_args: UpdateManyArgs) =>
    Promise.resolve({ count: 1 }),
  );

  await logout(refreshTokenFor(firstSession), now);
  await logoutAll(firstSession.userId, now);

  assert.deepEqual(updateMany.mock.calls[0]?.arguments[0].where, {
    id: "session-one",
    userId: "user-a",
    revokedAt: null,
  });
  assert.deepEqual(updateMany.mock.calls[1]?.arguments[0].where, {
    userId: "user-a",
    revokedAt: null,
  });
});

test("password reset updates the password and revokes all sessions transactionally", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const resettingUser = user({
    resetToken: "reset-token",
    resetTokenExpiresAt: new Date(now.getTime() + 60_000),
  });
  mockPrismaMethod(t, prisma.user, "findUnique", () => Promise.resolve(resettingUser));
  const updateUser = mockPrismaMethod(t, prisma.user, "update", () =>
    Promise.resolve(resettingUser),
  );
  const revokeSessions = mockPrismaMethod(
    t,
    prisma.authSession,
    "updateMany",
    (_args: UpdateManyArgs) => Promise.resolve({ count: 2 }),
  );
  mockUserLocks(t);
  const transaction = mockCallbackTransactions(t);

  await resetPassword({ token: "reset-token", password: "NewPassword123!" }, now);

  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(updateUser.mock.callCount(), 1);
  assert.deepEqual(revokeSessions.mock.calls[0]?.arguments[0].where, {
    userId: resettingUser.id,
    revokedAt: null,
  });
});

test("password reset revalidates and consumes only the locked current token", async (t) => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const requested = user({
    resetToken: "token-a",
    resetTokenExpiresAt: new Date(now.getTime() + 60_000),
  });
  const replaced = user({
    resetToken: "token-b",
    resetTokenExpiresAt: new Date(now.getTime() + 60_000),
  });
  let reads = 0;
  mockPrismaMethod(t, prisma.user, "findUnique", () => {
    reads += 1;
    return Promise.resolve(reads === 1 ? requested : replaced);
  });
  const updateUser = mockPrismaMethod(t, prisma.user, "update", () =>
    Promise.resolve(replaced),
  );
  const revokeSessions = mockPrismaMethod(
    t,
    prisma.authSession,
    "updateMany",
    (_args: UpdateManyArgs) => Promise.resolve({ count: 0 }),
  );
  mockUserLocks(t);
  mockCallbackTransactions(t);

  await assert.rejects(
    resetPassword({ token: "token-a", password: "NewPassword123!" }, now),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
  assert.equal(updateUser.mock.callCount(), 0);
  assert.equal(revokeSessions.mock.callCount(), 0);
});
