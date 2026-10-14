import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import type { FavLinkResponse } from "./favlinks.types";
import { list } from "./favlinks.service";

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const updatedAt = new Date("2026-01-02T00:00:00.000Z");

type FindManyArgs = { where: { userId: string; folderId?: string } };
type FindFolderArgs = { where: { id: string; userId: string } };

function mockPrismaMethod<F extends (...args: never[]) => unknown>(
  t: TestContext,
  target: object,
  methodName: string,
  implementation: F,
) {
  const original = Object.getOwnPropertyDescriptor(target, methodName);
  const mocked = t.mock.fn(implementation);
  Object.defineProperty(target, methodName, { ...original, value: mocked });
  t.after(() => {
    if (original) Object.defineProperty(target, methodName, original);
  });
  return mocked;
}

function favlink(id: string, folderId: string | null): FavLinkResponse {
  return {
    id,
    title: `Link ${id}`,
    url: `https://example.com/${id}`,
    folderId,
    createdAt,
    updatedAt,
  };
}

test("lists all of a user's favlinks when folderId is omitted", async (t) => {
  const expected = [favlink("nested", "folder-a"), favlink("root", null)];
  const findMany = mockPrismaMethod(t, prisma.favLink, "findMany", (_args: FindManyArgs) =>
    Promise.resolve(expected),
  );

  const result = await list("user-a", null);

  assert.deepEqual(result, expected);
  assert.equal(result[0]?.folderId, "folder-a");
  assert.equal(result[1]?.folderId, null);
  assert.deepEqual(findMany.mock.calls[0]?.arguments[0].where, { userId: "user-a" });
});

test("lists only favlinks in the requested owned folder", async (t) => {
  const expected = [favlink("nested", "folder-a")];
  const findFolder = mockPrismaMethod(t, prisma.folder, "findFirst", (_args: FindFolderArgs) =>
    Promise.resolve({ id: "folder-a" }),
  );
  const findMany = mockPrismaMethod(t, prisma.favLink, "findMany", (_args: FindManyArgs) =>
    Promise.resolve(expected),
  );

  const result = await list("user-a", "folder-a");

  assert.deepEqual(result, expected);
  assert.deepEqual(findFolder.mock.calls[0]?.arguments[0].where, {
    id: "folder-a",
    userId: "user-a",
  });
  assert.deepEqual(findMany.mock.calls[0]?.arguments[0].where, {
    userId: "user-a",
    folderId: "folder-a",
  });
});

test("returns an empty array when the user has no favlinks", async (t) => {
  const findMany = mockPrismaMethod(t, prisma.favLink, "findMany", (_args: FindManyArgs) =>
    Promise.resolve([]),
  );

  const result = await list("user-a", null);

  assert.deepEqual(result, []);
  assert.deepEqual(findMany.mock.calls[0]?.arguments[0].where, { userId: "user-a" });
});

test("never returns another user's favlinks", async (t) => {
  const stored = [
    { userId: "user-a", ...favlink("owned", "folder-a") },
    { userId: "user-b", ...favlink("foreign", "folder-b") },
  ];
  const findMany = mockPrismaMethod(t, prisma.favLink, "findMany", (args: FindManyArgs) =>
    Promise.resolve(
      stored
        .filter(
          (row) =>
            row.userId === args.where.userId &&
            (args.where.folderId === undefined || row.folderId === args.where.folderId),
        )
        .map(({ userId: _userId, ...row }) => row),
    ),
  );

  const result = await list("user-a", null);

  assert.deepEqual(result, [favlink("owned", "folder-a")]);
  assert.deepEqual(findMany.mock.calls[0]?.arguments[0].where, { userId: "user-a" });
});

test("rejects filtering by another user's folder", async (t) => {
  const findFolder = mockPrismaMethod(t, prisma.folder, "findFirst", (_args: FindFolderArgs) =>
    Promise.resolve(null),
  );
  const findMany = mockPrismaMethod(t, prisma.favLink, "findMany", (_args: FindManyArgs) =>
    Promise.resolve([]),
  );

  await assert.rejects(list("user-a", "folder-b"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 404);
    return true;
  });

  assert.deepEqual(findFolder.mock.calls[0]?.arguments[0].where, {
    id: "folder-b",
    userId: "user-a",
  });
  assert.equal(findMany.mock.callCount(), 0);
});
