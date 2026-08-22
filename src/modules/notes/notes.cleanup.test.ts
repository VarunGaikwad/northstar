import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/northstar_test";
process.env.JWT_SECRET ??= "notes-cleanup-test-jwt-secret";
process.env.JWT_REFRESH_SECRET ??= "notes-cleanup-test-refresh-secret-0000000000";
process.env.UNSPLASH_ACCESS_KEY ??= "notes-cleanup-test-unsplash-key";

let env: (typeof import("../../config/env.js"))["env"];
let prisma: (typeof import("../../db/prisma.js"))["prisma"];
let purgeClaimedNote: (typeof import("./notes.cleanup.js"))["purgeClaimedNote"];
let runNotesCleanup: (typeof import("./notes.cleanup.js"))["runNotesCleanup"];
let storageAdapter: (typeof import("./notes.storage.js"))["storageAdapter"];

before(async () => {
  ({ env } = await import("../../config/env.js"));
  ({ prisma } = await import("../../db/prisma.js"));
  ({ purgeClaimedNote, runNotesCleanup } = await import("./notes.cleanup.js"));
  ({ storageAdapter } = await import("./notes.storage.js"));
});

const MINUTE_MS = 60 * 1_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const RETRY_BACKOFF_MS = 25 * 60 * MINUTE_MS;
const TOKEN_REPLAY_GRACE_MS = 5 * MINUTE_MS;

type Awaitable<T> = T | Promise<T>;
type RawSql = {
  strings: readonly string[];
  values: readonly unknown[];
};
type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>;

type CleanupCaptures = {
  rawQueries: RawSql[];
  transactions: TransactionCallback[];
  noteUpdates: unknown[];
  noteDeletes: unknown[];
  imageAggregates: unknown[];
  imageFinds: unknown[];
  imageUpdates: unknown[];
  removedBatches: string[][];
  events: string[];
};

type CleanupHandlers = {
  rawQuery?: (
    query: RawSql,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  transaction?: (
    callback: TransactionCallback,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  noteUpdateMany?: (
    args: unknown,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  noteDeleteMany?: (
    args: unknown,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  imageAggregate?: (
    args: unknown,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  imageFindMany?: (
    args: unknown,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  imageUpdateMany?: (
    args: unknown,
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
  removeObjects?: (
    paths: string[],
    index: number,
    captures: CleanupCaptures,
  ) => Awaitable<unknown>;
};

function mockMethod<F extends (...args: never[]) => unknown>(
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

function mockValue(t: TestContext, target: object, key: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: original?.enumerable ?? true,
    writable: true,
    value,
  });
  t.after(() => {
    if (original) {
      Object.defineProperty(target, key, original);
    } else {
      Reflect.deleteProperty(target, key);
    }
  });
}

function asRawSql(query: unknown): RawSql {
  if (typeof query !== "object" || query === null) {
    throw new TypeError("Expected a parameterized Prisma SQL object");
  }
  const strings = (query as { strings?: unknown }).strings;
  const values = (query as { values?: unknown }).values;
  if (
    !Array.isArray(strings) ||
    !strings.every((part) => typeof part === "string") ||
    !Array.isArray(values)
  ) {
    throw new TypeError("Expected Prisma SQL strings and values");
  }
  return { strings, values };
}

function sqlText(query: RawSql): string {
  return query.strings.join("?").replace(/\s+/g, " ").trim();
}

function sqlLabel(query: RawSql): string {
  const text = sqlText(query);
  if (text.startsWith('SELECT "id" FROM "Note" WHERE "id"')) return "lock-note";
  if (text.includes('WHERE "trashedAt" <= ?')) return "claim-trash";
  if (
    text.includes('FROM "Note" WHERE "purgeRequestedAt" IS NOT NULL') &&
    text.includes("WITH candidates")
  ) {
    return "claim-due-notes";
  }
  if (text.includes('image."uploadExpiresAt" <= ?')) return "claim-expired-uploads";
  if (
    text.includes('image."uploadTokenExpiresAt"') &&
    text.includes("WITH candidates")
  ) {
    return "claim-due-images";
  }
  if (text.startsWith('SELECT note."id"')) return "lock-image-parents";
  if (text.startsWith('DELETE FROM "NoteImage"')) {
    return text.includes('note."purgeRequestedAt" IS NOT NULL')
      ? "delete-purge-images"
      : "delete-images";
  }
  return "other";
}

function unexpected(name: string, index: number): never {
  throw new Error(`Unexpected ${name} call #${index + 1}`);
}

function installCleanupMocks(
  t: TestContext,
  handlers: CleanupHandlers,
): CleanupCaptures {
  const captures: CleanupCaptures = {
    rawQueries: [],
    transactions: [],
    noteUpdates: [],
    noteDeletes: [],
    imageAggregates: [],
    imageFinds: [],
    imageUpdates: [],
    removedBatches: [],
    events: [],
  };

  mockMethod(t, prisma, "$queryRaw", (query: unknown) => {
    const raw = asRawSql(query);
    const index = captures.rawQueries.push(raw) - 1;
    captures.events.push(`raw.${sqlLabel(raw)}`);
    if (!handlers.rawQuery) return unexpected("raw query", index);
    return handlers.rawQuery(raw, index, captures);
  });
  mockMethod(t, prisma, "$transaction", (callback: TransactionCallback) => {
    const index = captures.transactions.push(callback) - 1;
    captures.events.push("transaction");
    if (handlers.transaction) {
      return handlers.transaction(callback, index, captures);
    }
    return callback(prisma as unknown as Prisma.TransactionClient);
  });
  mockMethod(t, prisma.note, "updateMany", (args: unknown) => {
    const index = captures.noteUpdates.push(args) - 1;
    captures.events.push("note.updateMany");
    if (!handlers.noteUpdateMany) return unexpected("note updateMany", index);
    return handlers.noteUpdateMany(args, index, captures);
  });
  mockMethod(t, prisma.note, "deleteMany", (args: unknown) => {
    const index = captures.noteDeletes.push(args) - 1;
    captures.events.push("note.deleteMany");
    if (!handlers.noteDeleteMany) return unexpected("note deleteMany", index);
    return handlers.noteDeleteMany(args, index, captures);
  });
  mockMethod(t, prisma.noteImage, "aggregate", (args: unknown) => {
    const index = captures.imageAggregates.push(args) - 1;
    captures.events.push("image.aggregate");
    if (!handlers.imageAggregate) return unexpected("image aggregate", index);
    return handlers.imageAggregate(args, index, captures);
  });
  mockMethod(t, prisma.noteImage, "findMany", (args: unknown) => {
    const index = captures.imageFinds.push(args) - 1;
    captures.events.push("image.findMany");
    if (!handlers.imageFindMany) return unexpected("image findMany", index);
    return handlers.imageFindMany(args, index, captures);
  });
  mockMethod(t, prisma.noteImage, "updateMany", (args: unknown) => {
    const index = captures.imageUpdates.push(args) - 1;
    captures.events.push("image.updateMany");
    if (!handlers.imageUpdateMany) return unexpected("image updateMany", index);
    return handlers.imageUpdateMany(args, index, captures);
  });
  mockMethod(t, storageAdapter, "removeObjects", (paths: string[]) => {
    const copiedPaths = [...paths];
    const index = captures.removedBatches.push(copiedPaths) - 1;
    captures.events.push("storage.removeObjects");
    if (!handlers.removeObjects) return unexpected("storage removeObjects", index);
    return handlers.removeObjects(copiedPaths, index, captures);
  });

  return captures;
}

function aggregate(
  count: number,
  latestTokenExpiry: Date | null,
  earliestUpdatedAt: Date | null,
) {
  return {
    _count: { _all: count },
    _max: { uploadTokenExpiresAt: latestTokenExpiry },
    _min: { updatedAt: earliestUpdatedAt },
  };
}

function assertDate(value: unknown, expectedTime: number): void {
  assert.ok(value instanceof Date);
  assert.equal(value.getTime(), expectedTime);
}

function countOccurrences(value: string, fragment: string): number {
  return value.split(fragment).length - 1;
}

function emptyCleanupResult() {
  return {
    claimedNotes: 0,
    purgedNotes: 0,
    deferredNotePurges: 0,
    failedNotePurges: 0,
    claimedUploads: 0,
    deletedImages: 0,
    deferredImageDeletes: 0,
    failedImageDeletes: 0,
  };
}

test("cleanup claims are parameterized, bounded, fair, skip locked, and exclude purging parents", async (t) => {
  const now = new Date("2026-08-22T06:00:00.000Z");
  const retryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
  mockValue(t, env, "NOTE_TRASH_RETENTION_MS", SEVEN_DAYS_MS);
  const captures = installCleanupMocks(t, {
    rawQuery: () => [],
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, emptyCleanupResult());
  assert.equal(captures.rawQueries.length, 4);
  assert.equal(captures.transactions.length, 0);
  assert.equal(captures.removedBatches.length, 0);

  const [trash, dueNotes, expiredUploads, dueImages] = captures.rawQueries;
  assert.equal(sqlLabel(trash), "claim-trash");
  const trashSql = sqlText(trash);
  assert.match(trashSql, /WHERE "trashedAt" <= \?/);
  assert.match(trashSql, /AND "purgeRequestedAt" IS NULL/);
  assert.match(trashSql, /ORDER BY "trashedAt" ASC, "id" ASC/);
  assert.match(trashSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(trashSql, /LIMIT \?/);
  assert.doesNotMatch(trashSql, /LIMIT 25/);
  assert.match(trashSql, /"version" = note\."version" \+ 1/);
  assert.match(trashSql, /WHERE note\."id" = candidates\."id" AND note\."purgeRequestedAt" IS NULL/);
  assertDate(trash.values[0], now.getTime() - SEVEN_DAYS_MS);
  assertDate(trash.values[1], now.getTime());
  assert.equal(trash.values[2], 25);

  assert.equal(sqlLabel(dueNotes), "claim-due-notes");
  const dueNotesSql = sqlText(dueNotes);
  assert.match(dueNotesSql, /"updatedAt" <= \?/);
  assert.match(
    dueNotesSql,
    /ORDER BY "updatedAt" ASC, "purgeRequestedAt" ASC, "id" ASC/,
  );
  assert.match(dueNotesSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(dueNotesSql, /LIMIT \?/);
  assert.doesNotMatch(dueNotesSql, /LIMIT 25/);
  assert.equal(dueNotes.values[1], 25);
  assertDate(dueNotes.values[2], retryAt.getTime());

  assert.equal(sqlLabel(expiredUploads), "claim-expired-uploads");
  const expiredUploadsSql = sqlText(expiredUploads);
  assert.match(expiredUploadsSql, /image\."uploadExpiresAt" <= \?/);
  assert.match(expiredUploadsSql, /ORDER BY image\."uploadExpiresAt" ASC, image\."id" ASC/);
  assert.match(expiredUploadsSql, /FOR UPDATE OF image, note SKIP LOCKED/);
  assert.match(expiredUploadsSql, /LIMIT \?/);
  assert.doesNotMatch(expiredUploadsSql, /LIMIT 50/);
  assert.match(expiredUploadsSql, /"position" = NULL/);
  assert.match(expiredUploadsSql, /"uploadExpiresAt" = NULL/);
  assert.ok(
    countOccurrences(expiredUploadsSql, 'note."purgeRequestedAt" IS NULL') >= 2,
  );
  assert.equal(expiredUploads.values[3], 50);
  assert.ok(expiredUploads.values.includes("PENDING"));
  assert.ok(expiredUploads.values.includes("DELETE_PENDING"));

  assert.equal(sqlLabel(dueImages), "claim-due-images");
  const dueImagesSql = sqlText(dueImages);
  assert.match(dueImagesSql, /image\."updatedAt" <= \?/);
  assert.match(dueImagesSql, /ORDER BY image\."updatedAt" ASC, image\."id" ASC/);
  assert.match(dueImagesSql, /FOR UPDATE OF image, note SKIP LOCKED/);
  assert.match(dueImagesSql, /LIMIT \?/);
  assert.doesNotMatch(dueImagesSql, /LIMIT 50/);
  assert.ok(countOccurrences(dueImagesSql, 'note."purgeRequestedAt" IS NULL') >= 2);
  assert.equal(dueImages.values[4], 50);
  assertDate(dueImages.values[5], retryAt.getTime());
});

test("one claimed-note purge processes at most 100 child paths", async (t) => {
  const now = new Date("2026-08-22T07:00:00.000Z");
  const latestTokenExpiry = new Date(now.getTime() + 10 * MINUTE_MS);
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `image-${index}`,
    storagePath: `notes/note-bounded/image-${index}`,
  }));
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      if (sqlLabel(query) === "lock-note") return [{ id: "note-bounded" }];
      return unexpected("bounded purge raw query", index);
    },
    noteUpdateMany: () => ({ count: 1 }),
    imageAggregate: () => aggregate(101, latestTokenExpiry, now),
    imageFindMany: (args) => {
      const take = (args as { take?: unknown }).take;
      return rows.slice(0, typeof take === "number" ? take : rows.length);
    },
    imageUpdateMany: (_args, index) => ({ count: [0, 100, 0, 100][index] ?? 0 }),
    removeObjects: () => undefined,
  });

  const outcome = await purgeClaimedNote("note-bounded", now);

  assert.equal(outcome, "deferred");
  assert.equal(captures.transactions.length, 2);
  assert.equal(captures.imageFinds.length, 1);
  assert.deepEqual(captures.imageFinds[0], {
    where: {
      noteId: "note-bounded",
      status: "DELETE_PENDING",
      updatedAt: { lte: now },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, storagePath: true },
  });
  assert.equal(captures.removedBatches.length, 1);
  assert.equal(captures.removedBatches[0].length, 100);
  assert.deepEqual(captures.removedBatches[0], rows.slice(0, 100).map((row) => row.storagePath));
  assert.ok(!captures.removedBatches[0].includes(rows[100].storagePath));
  assert.equal(captures.noteDeletes.length, 0);
});

test("a missing claimed note is an idempotent purge success", async (t) => {
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      if (sqlLabel(query) === "lock-note") return [];
      return unexpected("missing-note raw query", index);
    },
  });

  const outcome = await purgeClaimedNote(
    "missing-note",
    new Date("2026-08-22T08:00:00.000Z"),
  );

  assert.equal(outcome, "purged");
  assert.equal(captures.transactions.length, 1);
  assert.equal(captures.rawQueries.length, 1);
  assert.equal(captures.removedBatches.length, 0);
  assert.equal(captures.imageAggregates.length, 0);
  assert.equal(captures.noteDeletes.length, 0);
});

test("full-note purge retains paths to one common safe horizon then final-sweeps before parent deletion", async (t) => {
  const now = new Date("2026-08-22T09:00:00.000Z");
  const latestTokenExpiry = new Date(now.getTime() + 20 * MINUTE_MS);
  const commonSafeAt = new Date(latestTokenExpiry.getTime() + TOKEN_REPLAY_GRACE_MS);
  const firstRetryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
  const secondRetryAt = new Date(commonSafeAt.getTime() + RETRY_BACKOFF_MS);
  const images = [
    { id: "image-a", storagePath: "notes/note-full/image-a" },
    { id: "image-b", storagePath: "notes/note-full/image-b" },
  ];
  const aggregates = [
    aggregate(2, latestTokenExpiry, now),
    aggregate(2, latestTokenExpiry, firstRetryAt),
    aggregate(2, latestTokenExpiry, commonSafeAt),
    aggregate(2, latestTokenExpiry, commonSafeAt),
    aggregate(2, latestTokenExpiry, secondRetryAt),
    aggregate(0, null, null),
  ];
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      const label = sqlLabel(query);
      if (label === "lock-note") return [{ id: "note-full" }];
      if (label === "delete-purge-images") {
        return images.map((image) => ({ id: image.id }));
      }
      return unexpected("full-note raw query", index);
    },
    noteUpdateMany: () => ({ count: 1 }),
    noteDeleteMany: () => ({ count: 1 }),
    imageAggregate: (_args, index) =>
      aggregates[index] ?? unexpected("full-note aggregate fixture", index),
    imageFindMany: () => images,
    imageUpdateMany: (_args, index) => ({ count: [0, 2, 0, 2, 0, 2, 0][index] ?? 0 }),
    removeObjects: () => undefined,
  });

  const deferred = await purgeClaimedNote("note-full", now);

  assert.equal(deferred, "deferred");
  assert.equal(captures.removedBatches.length, 1);
  assert.deepEqual(captures.removedBatches[0], images.map((image) => image.storagePath));
  assert.equal(
    captures.rawQueries.filter((query) => sqlLabel(query) === "delete-purge-images").length,
    0,
  );
  assert.equal(captures.noteDeletes.length, 0);
  assert.deepEqual(captures.imageUpdates[3], {
    where: {
      id: { in: ["image-a", "image-b"] },
      noteId: "note-full",
      status: "DELETE_PENDING",
    },
    data: { updatedAt: commonSafeAt },
  });
  assert.deepEqual(captures.noteUpdates[1], {
    where: { id: "note-full", purgeRequestedAt: { not: null } },
    data: { updatedAt: commonSafeAt },
  });

  const purged = await purgeClaimedNote("note-full", commonSafeAt);

  assert.equal(purged, "purged");
  assert.deepEqual(captures.removedBatches, [
    images.map((image) => image.storagePath),
    images.map((image) => image.storagePath),
  ]);
  const deleteQuery = captures.rawQueries.find(
    (query) => sqlLabel(query) === "delete-purge-images",
  );
  assert.ok(deleteQuery);
  const deleteSql = sqlText(deleteQuery);
  assert.match(deleteSql, /note\."purgeRequestedAt" IS NOT NULL/);
  assert.match(deleteSql, /image\."status" = \?::"NoteImageStatus"/);
  assert.ok(deleteQuery.values.includes("image-a"));
  assert.ok(deleteQuery.values.includes("image-b"));
  assert.ok(deleteQuery.values.includes("note-full"));
  assert.ok(deleteQuery.values.includes("DELETE_PENDING"));
  assert.ok(
    deleteQuery.values.some(
      (value) => value instanceof Date && value.getTime() === latestTokenExpiry.getTime(),
    ),
  );
  assert.deepEqual(captures.noteDeletes[0], {
    where: {
      id: "note-full",
      purgeRequestedAt: { not: null },
      images: { none: {} },
    },
  });
  const finalSweepIndex = captures.events.lastIndexOf("storage.removeObjects");
  const childDeleteIndex = captures.events.indexOf("raw.delete-purge-images");
  const parentDeleteIndex = captures.events.indexOf("note.deleteMany");
  assert.ok(finalSweepIndex < childDeleteIndex);
  assert.ok(childDeleteIndex < parentDeleteIndex);
});

test("abandoned uploads are claimed and adapter-normalized provider 404 is idempotent success", async (t) => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const upload = {
    id: "abandoned-upload",
    noteId: "note-active",
    storagePath: "notes/note-active/abandoned-upload",
    uploadTokenExpiresAt: new Date(now.getTime() + 10 * MINUTE_MS),
  };
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      switch (sqlLabel(query)) {
        case "claim-trash":
        case "claim-due-notes":
        case "claim-due-images":
          return [];
        case "claim-expired-uploads":
          return [upload];
        default:
          return unexpected("abandoned-upload raw query", index);
      }
    },
    removeObjects: () => undefined,
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    ...emptyCleanupResult(),
    claimedUploads: 1,
    deferredImageDeletes: 1,
  });
  assert.deepEqual(captures.removedBatches, [[upload.storagePath]]);
  assert.equal(captures.imageUpdates.length, 0);
  const claim = captures.rawQueries.find(
    (query) => sqlLabel(query) === "claim-expired-uploads",
  );
  assert.ok(claim);
  assert.match(sqlText(claim), /"status" = \?::"NoteImageStatus"/);
  assert.match(sqlText(claim), /"position" = NULL/);
  assert.match(sqlText(claim), /"uploadExpiresAt" = NULL/);
});

test("provider removal failure schedules image retries 25 hours later", async (t) => {
  const now = new Date("2026-08-22T11:00:00.000Z");
  const retryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
  const image = {
    id: "image-provider-failure",
    noteId: "note-active",
    storagePath: "notes/note-active/image-provider-failure",
    uploadTokenExpiresAt: new Date(now.getTime() - 10 * MINUTE_MS),
  };
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      switch (sqlLabel(query)) {
        case "claim-trash":
        case "claim-due-notes":
        case "claim-expired-uploads":
          return [];
        case "claim-due-images":
          return [image];
        default:
          return unexpected("provider-failure raw query", index);
      }
    },
    imageUpdateMany: () => ({ count: 1 }),
    removeObjects: () => {
      throw new Error("provider unavailable");
    },
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    ...emptyCleanupResult(),
    failedImageDeletes: 1,
  });
  assert.deepEqual(captures.removedBatches, [[image.storagePath]]);
  assert.equal(captures.transactions.length, 0);
  assert.deepEqual(captures.imageUpdates, [
    {
      where: {
        id: { in: [image.id] },
        status: "DELETE_PENDING",
        note: { is: { purgeRequestedAt: null } },
      },
      data: { updatedAt: retryAt },
    },
  ]);
  assert.equal(retryAt.getTime() - now.getTime(), 25 * 60 * MINUTE_MS);
});

test("provider failures remain counted when retry scheduling also fails", async (t) => {
  const now = new Date("2026-08-22T11:30:00.000Z");
  const image = {
    id: "image-provider-and-database-failure",
    noteId: "note-active",
    storagePath: "notes/note-active/image-provider-and-database-failure",
    uploadTokenExpiresAt: new Date(now.getTime() - 10 * MINUTE_MS),
  };
  installCleanupMocks(t, {
    rawQuery: (query, index) => {
      switch (sqlLabel(query)) {
        case "claim-trash":
        case "claim-due-notes":
        case "claim-expired-uploads":
          return [];
        case "claim-due-images":
          return [image];
        default:
          return unexpected("double-failure raw query", index);
      }
    },
    imageUpdateMany: () => {
      throw new Error("retry database unavailable");
    },
    removeObjects: () => {
      throw new Error("provider unavailable");
    },
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    ...emptyCleanupResult(),
    failedImageDeletes: 1,
  });
});

test("database delete failure after provider success schedules a 25-hour retry", async (t) => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const retryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
  const image = {
    id: "image-database-failure",
    noteId: "note-active",
    storagePath: "notes/note-active/image-database-failure",
    uploadTokenExpiresAt: new Date(now.getTime() - 10 * MINUTE_MS),
  };
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      switch (sqlLabel(query)) {
        case "claim-trash":
        case "claim-due-notes":
        case "claim-expired-uploads":
          return [];
        case "claim-due-images":
          return [image];
        case "lock-image-parents":
          return [{ id: image.noteId }];
        case "delete-images":
          throw new Error("database unavailable");
        default:
          return unexpected("database-failure raw query", index);
      }
    },
    imageUpdateMany: () => ({ count: 1 }),
    removeObjects: () => undefined,
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    ...emptyCleanupResult(),
    failedImageDeletes: 1,
  });
  assert.equal(captures.transactions.length, 1);
  assert.deepEqual(captures.removedBatches, [[image.storagePath]]);
  assert.deepEqual(captures.imageUpdates, [
    {
      where: {
        id: { in: [image.id] },
        status: "DELETE_PENDING",
        note: { is: { purgeRequestedAt: null } },
      },
      data: { updatedAt: retryAt },
    },
  ]);
  const providerIndex = captures.events.indexOf("storage.removeObjects");
  const deleteIndex = captures.events.indexOf("raw.delete-images");
  const retryIndex = captures.events.indexOf("image.updateMany");
  assert.ok(providerIndex < deleteIndex);
  assert.ok(deleteIndex < retryIndex);
});

test("image tombstone final sweep conditionally deletes rows and tolerates a concurrently missing row", async (t) => {
  const now = new Date("2026-08-22T13:00:00.000Z");
  const tokenExpiry = new Date(now.getTime() - 10 * MINUTE_MS);
  const rows = [
    {
      id: "image-deleted",
      noteId: "note-active",
      storagePath: "notes/note-active/image-deleted",
      uploadTokenExpiresAt: tokenExpiry,
    },
    {
      id: "image-missing",
      noteId: "note-active",
      storagePath: "notes/note-active/image-missing",
      uploadTokenExpiresAt: tokenExpiry,
    },
  ];
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      switch (sqlLabel(query)) {
        case "claim-trash":
        case "claim-due-notes":
        case "claim-expired-uploads":
          return [];
        case "claim-due-images":
          return rows;
        case "lock-image-parents":
          return [{ id: "note-active" }];
        case "delete-images":
          return [{ id: "image-deleted" }];
        default:
          return unexpected("image-final-sweep raw query", index);
      }
    },
    imageFindMany: () => [],
    removeObjects: () => undefined,
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    ...emptyCleanupResult(),
    deletedImages: 1,
  });
  assert.deepEqual(captures.removedBatches, [rows.map((row) => row.storagePath)]);
  assert.equal(captures.imageUpdates.length, 0);
  assert.deepEqual(captures.imageFinds, [
    {
      where: { id: { in: ["image-deleted", "image-missing"] } },
      select: {
        id: true,
        status: true,
        uploadTokenExpiresAt: true,
        note: { select: { purgeRequestedAt: true } },
      },
    },
  ]);
  const deletion = captures.rawQueries.find((query) => sqlLabel(query) === "delete-images");
  assert.ok(deletion);
  const deletionSql = sqlText(deletion);
  assert.match(deletionSql, /note\."purgeRequestedAt" IS NULL/);
  assert.match(deletionSql, /image\."status" = \?::"NoteImageStatus"/);
  assert.ok(
    deletion.values.some(
      (value) =>
        value instanceof Date &&
        value.getTime() === now.getTime() - TOKEN_REPLAY_GRACE_MS,
    ),
  );
  const providerIndex = captures.events.indexOf("storage.removeObjects");
  const deletionIndex = captures.events.indexOf("raw.delete-images");
  assert.ok(providerIndex < deletionIndex);
});

test("cleanup returns exact aggregate batch counts across note and image outcomes", async (t) => {
  const now = new Date("2026-08-22T14:00:00.000Z");
  const oldTokenExpiry = new Date(now.getTime() - 10 * MINUTE_MS);
  const futureChildDueAt = new Date(now.getTime() + 30 * MINUTE_MS);
  const abandonedUpload = {
    id: "upload-future",
    noteId: "note-active",
    storagePath: "notes/note-active/upload-future",
    uploadTokenExpiresAt: new Date(now.getTime() + 10 * MINUTE_MS),
  };
  const dueImages = [
    {
      id: "image-deleted",
      noteId: "note-active",
      storagePath: "notes/note-active/image-deleted",
      uploadTokenExpiresAt: oldTokenExpiry,
    },
    {
      id: "image-retry",
      noteId: "note-active",
      storagePath: "notes/note-active/image-retry",
      uploadTokenExpiresAt: oldTokenExpiry,
    },
    {
      id: "image-missing",
      noteId: "note-active",
      storagePath: "notes/note-active/image-missing",
      uploadTokenExpiresAt: oldTokenExpiry,
    },
  ];
  const captures = installCleanupMocks(t, {
    rawQuery: (query, index) => {
      const label = sqlLabel(query);
      if (label === "claim-trash") {
        return [{ id: "newly-claimed-a" }, { id: "newly-claimed-b" }];
      }
      if (label === "claim-due-notes") {
        return [
          { id: "note-missing" },
          { id: "note-deferred" },
          { id: "note-failed" },
        ];
      }
      if (label === "lock-note") {
        const noteId = query.values[0];
        if (noteId === "note-missing") return [];
        if (noteId === "note-deferred") return [{ id: noteId }];
        if (noteId === "note-failed") throw new Error("lock unavailable");
      }
      if (label === "claim-expired-uploads") return [abandonedUpload];
      if (label === "claim-due-images") return dueImages;
      if (label === "lock-image-parents") return [{ id: "note-active" }];
      if (label === "delete-images") return [{ id: "image-deleted" }];
      return unexpected("batch-count raw query", index);
    },
    noteUpdateMany: () => ({ count: 1 }),
    imageAggregate: () => aggregate(1, oldTokenExpiry, futureChildDueAt),
    imageFindMany: (args) => {
      const where = (args as { where?: { noteId?: unknown } }).where;
      if (where?.noteId === "note-deferred") return [];
      return [
        {
          id: "image-retry",
          status: "DELETE_PENDING",
          uploadTokenExpiresAt: oldTokenExpiry,
          note: { purgeRequestedAt: null },
        },
      ];
    },
    imageUpdateMany: (args) => {
      const where = (args as { where?: { noteId?: unknown } }).where;
      return { count: where?.noteId === "note-deferred" ? 0 : 1 };
    },
    removeObjects: () => undefined,
  });

  const result = await runNotesCleanup(now);

  assert.deepEqual(result, {
    claimedNotes: 2,
    purgedNotes: 1,
    deferredNotePurges: 1,
    failedNotePurges: 1,
    claimedUploads: 1,
    deletedImages: 1,
    deferredImageDeletes: 1,
    failedImageDeletes: 1,
  });
  assert.equal(captures.transactions.length, 4);
  assert.equal(captures.noteUpdates.length, 2);
  assert.equal(captures.imageAggregates.length, 1);
  assert.equal(captures.imageFinds.length, 2);
  assert.equal(captures.imageUpdates.length, 2);
  assert.deepEqual(captures.removedBatches, [
    [abandonedUpload.storagePath],
    dueImages.map((image) => image.storagePath),
  ]);
  assert.equal(captures.noteDeletes.length, 0);
});
