import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { NoteColor, NoteImageStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  archiveNote,
  confirmNoteImage,
  createImageUploadIntent,
  createNote,
  deleteNoteImage,
  getNote,
  listNotes,
  patchNote,
  permanentlyDeleteNote,
  reorderNoteImages,
  restoreNote,
  trashNote,
  unarchiveNote,
} from "./notes.service";
import { storageAdapter } from "./notes.storage";
import {
  NOTE_IMAGE_LIMIT,
  UPLOAD_INTENT_TTL_MS,
  UPLOAD_TOKEN_REPLAY_GRACE_MS,
  type NoteResponse,
} from "./notes.types";

const USER_ID = "user-a";
const NOTE_ID = "note-a";
const CREATED_AT = new Date("2026-08-20T01:00:00.000Z");
const UPDATED_AT = new Date("2026-08-21T02:00:00.000Z");

type Implementation = (...args: never[]) => unknown;
type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>;
type MethodKey =
  | "transaction"
  | "queryRaw"
  | "noteCreate"
  | "noteFindFirst"
  | "noteFindMany"
  | "noteUpdate"
  | "noteUpdateMany"
  | "noteDeleteMany"
  | "imageCount"
  | "imageCreate"
  | "imageUpdate"
  | "imageFindFirst"
  | "imageFindMany"
  | "imageUpdateMany"
  | "imageDeleteMany"
  | "imageAggregate"
  | "createSignedUploadUrl"
  | "createSignedReadUrls"
  | "getObjectInfo"
  | "removeObjects";

type HarnessImplementations = Partial<Record<MethodKey, Implementation>>;

type ReadyImageRow = {
  id: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  position: number | null;
};

type NoteRow = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  archivedAt: Date | null;
  trashedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  images: ReadyImageRow[];
};

type ImageRow = {
  id: string;
  noteId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  position: number | null;
  status: NoteImageStatus;
  uploadExpiresAt: Date | null;
  uploadTokenExpiresAt: Date;
  updatedAt: Date;
};

type OwnedImageRow = ImageRow & { note: NoteRow };

function mockMethod<F extends Implementation>(
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

function unexpected(methodName: string): Implementation {
  return () => {
    throw new Error(`Unexpected call to ${methodName}`);
  };
}

function serviceHarness(
  t: TestContext,
  implementations: HarnessImplementations = {},
) {
  const callbackTransaction: Implementation = (callback: TransactionCallback) =>
    callback(prisma as unknown as Prisma.TransactionClient);
  const implementation = (key: MethodKey, displayName: string) =>
    implementations[key] ?? unexpected(displayName);

  return {
    transaction: mockMethod(
      t,
      prisma,
      "$transaction",
      implementations.transaction ?? callbackTransaction,
    ),
    queryRaw: mockMethod(
      t,
      prisma,
      "$queryRaw",
      implementation("queryRaw", "prisma.$queryRaw"),
    ),
    noteCreate: mockMethod(
      t,
      prisma.note,
      "create",
      implementation("noteCreate", "prisma.note.create"),
    ),
    noteFindFirst: mockMethod(
      t,
      prisma.note,
      "findFirst",
      implementation("noteFindFirst", "prisma.note.findFirst"),
    ),
    noteFindMany: mockMethod(
      t,
      prisma.note,
      "findMany",
      implementation("noteFindMany", "prisma.note.findMany"),
    ),
    noteUpdate: mockMethod(
      t,
      prisma.note,
      "update",
      implementation("noteUpdate", "prisma.note.update"),
    ),
    noteUpdateMany: mockMethod(
      t,
      prisma.note,
      "updateMany",
      implementation("noteUpdateMany", "prisma.note.updateMany"),
    ),
    noteDeleteMany: mockMethod(
      t,
      prisma.note,
      "deleteMany",
      implementation("noteDeleteMany", "prisma.note.deleteMany"),
    ),
    imageCount: mockMethod(
      t,
      prisma.noteImage,
      "count",
      implementation("imageCount", "prisma.noteImage.count"),
    ),
    imageCreate: mockMethod(
      t,
      prisma.noteImage,
      "create",
      implementation("imageCreate", "prisma.noteImage.create"),
    ),
    imageUpdate: mockMethod(
      t,
      prisma.noteImage,
      "update",
      implementation("imageUpdate", "prisma.noteImage.update"),
    ),
    imageFindFirst: mockMethod(
      t,
      prisma.noteImage,
      "findFirst",
      implementation("imageFindFirst", "prisma.noteImage.findFirst"),
    ),
    imageFindMany: mockMethod(
      t,
      prisma.noteImage,
      "findMany",
      implementation("imageFindMany", "prisma.noteImage.findMany"),
    ),
    imageUpdateMany: mockMethod(
      t,
      prisma.noteImage,
      "updateMany",
      implementation("imageUpdateMany", "prisma.noteImage.updateMany"),
    ),
    imageDeleteMany: mockMethod(
      t,
      prisma.noteImage,
      "deleteMany",
      implementation("imageDeleteMany", "prisma.noteImage.deleteMany"),
    ),
    imageAggregate: mockMethod(
      t,
      prisma.noteImage,
      "aggregate",
      implementation("imageAggregate", "prisma.noteImage.aggregate"),
    ),
    createSignedUploadUrl: mockMethod(
      t,
      storageAdapter,
      "createSignedUploadUrl",
      implementation(
        "createSignedUploadUrl",
        "storageAdapter.createSignedUploadUrl",
      ),
    ),
    createSignedReadUrls: mockMethod(
      t,
      storageAdapter,
      "createSignedReadUrls",
      implementation(
        "createSignedReadUrls",
        "storageAdapter.createSignedReadUrls",
      ),
    ),
    getObjectInfo: mockMethod(
      t,
      storageAdapter,
      "getObjectInfo",
      implementation("getObjectInfo", "storageAdapter.getObjectInfo"),
    ),
    removeObjects: mockMethod(
      t,
      storageAdapter,
      "removeObjects",
      implementation("removeObjects", "storageAdapter.removeObjects"),
    ),
  };
}

type RecordedMock = {
  mock: {
    calls: ReadonlyArray<{ arguments: readonly unknown[] }>;
    callCount(): number;
  };
};

function callArgument<T>(
  mocked: RecordedMock,
  callIndex = 0,
  argumentIndex = 0,
): T {
  const call = mocked.mock.calls[callIndex];
  assert.ok(call, `Expected mock call ${callIndex + 1}`);
  return call.arguments[argumentIndex] as T;
}

function inspectSql(query: unknown): {
  text: string;
  values: readonly unknown[];
} {
  assert.ok(typeof query === "object" && query !== null, "Expected Prisma SQL");
  const sql = query as { strings?: unknown; values?: unknown };
  assert.ok(Array.isArray(sql.strings), "Expected Prisma SQL strings");
  assert.ok(Array.isArray(sql.values), "Expected Prisma SQL values");
  return {
    text: sql.strings.join("?").replace(/\s+/g, " ").trim(),
    values: sql.values,
  };
}

async function rejectsApi(
  promise: Promise<unknown>,
  statusCode: number,
  message?: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, statusCode);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

function readyImage(overrides: Partial<ReadyImageRow> = {}): ReadyImageRow {
  return {
    id: "image-a",
    storagePath: `users/${USER_ID}/notes/${NOTE_ID}/image-a.png`,
    mimeType: "image/png",
    sizeBytes: 4096,
    position: 0,
    ...overrides,
  };
}

function noteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: NOTE_ID,
    title: "Title",
    content: "Content",
    color: "DEFAULT",
    isPinned: false,
    archivedAt: null,
    trashedAt: null,
    version: 3,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    images: [],
    ...overrides,
  };
}

function imageRow(overrides: Partial<ImageRow> = {}): ImageRow {
  const uploadExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  return {
    id: "image-a",
    noteId: NOTE_ID,
    storagePath: `users/${USER_ID}/notes/${NOTE_ID}/image-a.png`,
    mimeType: "image/png",
    sizeBytes: 4096,
    position: null,
    status: "PENDING",
    uploadExpiresAt,
    uploadTokenExpiresAt: uploadExpiresAt,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function ownedImageRow(overrides: Partial<OwnedImageRow> = {}): OwnedImageRow {
  return {
    ...imageRow(overrides),
    note: overrides.note ?? noteRow(),
  };
}

function mutationState(
  source: NoteRow,
  purgeRequestedAt: Date | null = null,
) {
  return {
    id: source.id,
    version: source.version,
    archivedAt: source.archivedAt,
    trashedAt: source.trashedAt,
    purgeRequestedAt,
  };
}

function assertNoStorageCalls(harness: ReturnType<typeof serviceHarness>): void {
  assert.equal(harness.createSignedUploadUrl.mock.callCount(), 0);
  assert.equal(harness.createSignedReadUrls.mock.callCount(), 0);
  assert.equal(harness.getObjectInfo.mock.callCount(), 0);
  assert.equal(harness.removeObjects.mock.callCount(), 0);
}

async function assertSimpleMutation(options: {
  t: TestContext;
  before: NoteRow;
  after: NoteRow;
  invoke: () => Promise<NoteResponse>;
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}): Promise<void> {
  let reads = 0;
  const harness = serviceHarness(options.t, {
    noteFindFirst: () => {
      reads += 1;
      return Promise.resolve(reads === 1 ? options.before : options.after);
    },
    noteUpdateMany: () => Promise.resolve({ count: 1 }),
  });

  const result = await options.invoke();

  assert.equal(result.version, options.after.version);
  assert.equal(harness.transaction.mock.callCount(), 1);
  assert.equal(harness.noteFindFirst.mock.callCount(), 2);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 1);
  assert.equal(harness.noteUpdate.mock.callCount(), 0);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    { where: options.where, data: options.data },
  );
  assertNoStorageCalls(harness);
}

test("create applies note defaults and performs no storage I/O", async (t) => {
  const created = noteRow({
    title: "",
    content: "",
    color: "DEFAULT",
    version: 1,
  });
  const harness = serviceHarness(t, {
    noteCreate: () => Promise.resolve(created),
  });

  const result = await createNote(USER_ID, {});

  assert.equal(result.version, 1);
  assert.deepEqual(result.images, []);
  assert.deepEqual(
    callArgument<{ data: unknown }>(harness.noteCreate).data,
    {
      userId: USER_ID,
      title: "",
      content: "",
      color: "DEFAULT",
    },
  );
  assertNoStorageCalls(harness);
});

test("missing and foreign notes and images share 404s before storage I/O", async (t) => {
  const harness = serviceHarness(t, {
    noteFindFirst: () => Promise.resolve(null),
    imageFindFirst: () => Promise.resolve(null),
  });

  await rejectsApi(getNote(USER_ID, "missing-note"), 404, "Note not found");
  await rejectsApi(getNote(USER_ID, "foreign-note"), 404, "Note not found");
  await rejectsApi(
    deleteNoteImage(USER_ID, NOTE_ID, "missing-image", 3),
    404,
    "Note image not found",
  );
  await rejectsApi(
    deleteNoteImage(USER_ID, NOTE_ID, "foreign-image", 3),
    404,
    "Note image not found",
  );

  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.noteFindFirst, 0).where,
    { id: "missing-note", userId: USER_ID, purgeRequestedAt: null },
  );
  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.noteFindFirst, 1).where,
    { id: "foreign-note", userId: USER_ID, purgeRequestedAt: null },
  );
  for (const [callIndex, imageId] of ["missing-image", "foreign-image"].entries()) {
    assert.deepEqual(
      callArgument<{ where: unknown }>(harness.imageFindFirst, callIndex).where,
      {
        id: imageId,
        noteId: NOTE_ID,
        note: {
          is: {
            id: NOTE_ID,
            userId: USER_ID,
            purgeRequestedAt: null,
          },
        },
      },
    );
  }
  assert.equal(harness.transaction.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("list applies active, archived, and trash scopes and deterministic ordering", async (t) => {
  const harness = serviceHarness(t, {
    noteFindMany: () => Promise.resolve([]),
  });

  await listNotes(USER_ID, { view: "active", limit: 2, cursor: null });
  await listNotes(USER_ID, { view: "archived", limit: 4, cursor: null });
  await listNotes(USER_ID, { view: "trash", limit: 6, cursor: null });

  const active = callArgument<{
    where: unknown;
    orderBy: unknown;
    take: number;
  }>(harness.noteFindMany, 0);
  assert.deepEqual(active.where, {
    userId: USER_ID,
    purgeRequestedAt: null,
    trashedAt: null,
    archivedAt: null,
    AND: undefined,
  });
  assert.deepEqual(active.orderBy, [
    { isPinned: "desc" },
    { updatedAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(active.take, 3);

  const archived = callArgument<{
    where: unknown;
    orderBy: unknown;
    take: number;
  }>(harness.noteFindMany, 1);
  assert.deepEqual(archived.where, {
    userId: USER_ID,
    purgeRequestedAt: null,
    trashedAt: null,
    archivedAt: { not: null },
    AND: undefined,
  });
  assert.deepEqual(archived.orderBy, [
    { updatedAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(archived.take, 5);

  const trash = callArgument<{
    where: unknown;
    orderBy: unknown;
    take: number;
  }>(harness.noteFindMany, 2);
  assert.deepEqual(trash.where, {
    userId: USER_ID,
    purgeRequestedAt: null,
    trashedAt: { not: null },
    AND: undefined,
  });
  assert.deepEqual(trash.orderBy, [
    { trashedAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(trash.take, 7);
  assertNoStorageCalls(harness);
});

test("active cursors preserve timestamp ties and the pinned-to-unpinned transition", async (t) => {
  const harness = serviceHarness(t, {
    noteFindMany: () => Promise.resolve([]),
  });
  const cursorTime = "2026-08-21T02:00:00.000Z";
  const cursorDate = new Date(cursorTime);

  await listNotes(USER_ID, {
    view: "active",
    limit: 5,
    cursor: {
      view: "active",
      isPinned: true,
      updatedAt: cursorTime,
      id: "cursor-pinned",
    },
  });
  await listNotes(USER_ID, {
    view: "active",
    limit: 5,
    cursor: {
      view: "active",
      isPinned: false,
      updatedAt: cursorTime,
      id: "cursor-unpinned",
    },
  });

  assert.deepEqual(
    callArgument<{ where: { AND: unknown } }>(harness.noteFindMany, 0).where.AND,
    {
      OR: [
        {
          isPinned: true,
          OR: [
            { updatedAt: { lt: cursorDate } },
            { updatedAt: cursorDate, id: { lt: "cursor-pinned" } },
          ],
        },
        { isPinned: false },
      ],
    },
  );
  assert.deepEqual(
    callArgument<{ where: { AND: unknown } }>(harness.noteFindMany, 1).where.AND,
    {
      isPinned: false,
      OR: [
        { updatedAt: { lt: cursorDate } },
        { updatedAt: cursorDate, id: { lt: "cursor-unpinned" } },
      ],
    },
  );
  assertNoStorageCalls(harness);
});

test("get returns an explicit DTO and omits every internal note and image field", async (t) => {
  const image = {
    ...readyImage(),
    noteId: NOTE_ID,
    status: "READY",
    uploadExpiresAt: null,
    uploadTokenExpiresAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
  };
  const stored = {
    ...noteRow({ images: [image] }),
    userId: USER_ID,
    purgeRequestedAt: null,
  };
  const harness = serviceHarness(t, {
    noteFindFirst: () => Promise.resolve(stored),
    createSignedReadUrls: (paths: string[]) =>
      Promise.resolve(new Map([[paths[0]!, "https://signed.example/image-a"]])),
  });

  const result = await getNote(USER_ID, NOTE_ID);

  assert.deepEqual(Object.keys(result).sort(), [
    "archivedAt",
    "color",
    "content",
    "createdAt",
    "id",
    "images",
    "isPinned",
    "title",
    "trashedAt",
    "updatedAt",
    "version",
  ]);
  assert.deepEqual(Object.keys(result.images[0]!).sort(), [
    "id",
    "mimeType",
    "position",
    "sizeBytes",
    "url",
    "urlExpiresAt",
  ]);
  assert.equal(result.images[0]?.url, "https://signed.example/image-a");
  assert.equal("userId" in result, false);
  assert.equal("purgeRequestedAt" in result, false);
  assert.equal("storagePath" in result.images[0]!, false);
  assert.equal("status" in result.images[0]!, false);
  assert.equal("uploadExpiresAt" in result.images[0]!, false);
  assert.deepEqual(
    callArgument<string[]>(harness.createSignedReadUrls),
    [image.storagePath],
  );
  assert.equal(harness.createSignedReadUrls.mock.callCount(), 1);
});

test("zero-image reads do not initialize or call storage", async (t) => {
  const harness = serviceHarness(t, {
    noteFindFirst: () => Promise.resolve(noteRow({ images: [] })),
  });

  const result = await getNote(USER_ID, NOTE_ID);

  assert.deepEqual(result.images, []);
  assertNoStorageCalls(harness);
});

test("a stale CAS is classified without any unconditional fallback write", async (t) => {
  const before = noteRow({ version: 3 });
  let reads = 0;
  const harness = serviceHarness(t, {
    noteFindFirst: () => {
      reads += 1;
      return Promise.resolve(
        reads === 1
          ? before
          : { version: 4, purgeRequestedAt: null },
      );
    },
    noteUpdateMany: () => Promise.resolve({ count: 0 }),
  });

  await rejectsApi(
    patchNote(USER_ID, NOTE_ID, { title: "Concurrent edit" }, 3),
    412,
    "Note version does not match If-Match",
  );

  assert.equal(harness.noteUpdateMany.mock.callCount(), 1);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    {
      where: {
        id: NOTE_ID,
        userId: USER_ID,
        version: 3,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: {
        title: "Concurrent edit",
        version: { increment: 1 },
      },
    },
  );
  assert.equal(harness.noteUpdate.mock.callCount(), 0);
  assert.equal(harness.noteFindFirst.mock.callCount(), 2);
  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.noteFindFirst, 1).where,
    { id: NOTE_ID, userId: USER_ID },
  );
  assert.equal(harness.transaction.mock.callCount(), 1);
  assertNoStorageCalls(harness);
});

test("response signing failure happens before a visible mutation transaction", async (t) => {
  const image = readyImage();
  const harness = serviceHarness(t, {
    noteFindFirst: () => Promise.resolve(noteRow({ images: [image] })),
    createSignedReadUrls: () => Promise.reject(new Error("provider detail")),
  });

  await rejectsApi(
    patchNote(USER_ID, NOTE_ID, { content: "Must not commit" }, 3),
    503,
    "Storage service unavailable",
  );

  assert.equal(harness.createSignedReadUrls.mock.callCount(), 1);
  assert.equal(harness.transaction.mock.callCount(), 0);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assert.equal(harness.noteUpdate.mock.callCount(), 0);
});

test("pinning an active note writes only the requested field and one version increment", async (t) => {
  const before = noteRow({ version: 7, isPinned: false });
  const after = noteRow({ version: 8, isPinned: true });

  await assertSimpleMutation({
    t,
    before,
    after,
    invoke: () => patchNote(USER_ID, NOTE_ID, { isPinned: true }, 7),
    where: {
      id: NOTE_ID,
      userId: USER_ID,
      version: 7,
      purgeRequestedAt: null,
      trashedAt: null,
      archivedAt: null,
    },
    data: {
      isPinned: true,
      version: { increment: 1 },
    },
  });
});

test("pinning an archived note is rejected before signing or mutation", async (t) => {
  const harness = serviceHarness(t, {
    noteFindFirst: () =>
      Promise.resolve(
        noteRow({ archivedAt: new Date("2026-08-21T03:00:00.000Z") }),
      ),
  });

  await rejectsApi(
    patchNote(USER_ID, NOTE_ID, { isPinned: true }, 3),
    409,
    "Note state does not allow this operation",
  );

  assert.equal(harness.transaction.mock.callCount(), 0);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("archive clears pin state and increments the version exactly once", async (t) => {
  const archivedAt = new Date("2026-08-21T04:00:00.000Z");
  const before = noteRow({ version: 4, isPinned: true });
  const after = noteRow({
    version: 5,
    isPinned: false,
    archivedAt,
  });

  await assertSimpleMutation({
    t,
    before,
    after,
    invoke: () => archiveNote(USER_ID, NOTE_ID, 4, archivedAt),
    where: {
      id: NOTE_ID,
      userId: USER_ID,
      version: 4,
      purgeRequestedAt: null,
      trashedAt: null,
      archivedAt: null,
    },
    data: {
      archivedAt,
      isPinned: false,
      version: { increment: 1 },
    },
  });
});

test("unarchive clears only archivedAt and increments the version exactly once", async (t) => {
  const archivedAt = new Date("2026-08-21T04:00:00.000Z");
  const before = noteRow({ version: 5, archivedAt });
  const after = noteRow({ version: 6, archivedAt: null });

  await assertSimpleMutation({
    t,
    before,
    after,
    invoke: () => unarchiveNote(USER_ID, NOTE_ID, 5),
    where: {
      id: NOTE_ID,
      userId: USER_ID,
      version: 5,
      purgeRequestedAt: null,
      trashedAt: null,
      archivedAt: { not: null },
    },
    data: {
      archivedAt: null,
      version: { increment: 1 },
    },
  });
});

test("trash preserves prior lifecycle fields and changes only trashedAt plus version", async (t) => {
  const trashedAt = new Date("2026-08-21T05:00:00.000Z");
  const before = noteRow({ version: 8, isPinned: true });
  const after = noteRow({ version: 9, isPinned: true, trashedAt });

  await assertSimpleMutation({
    t,
    before,
    after,
    invoke: () => trashNote(USER_ID, NOTE_ID, 8, trashedAt),
    where: {
      id: NOTE_ID,
      userId: USER_ID,
      version: 8,
      purgeRequestedAt: null,
      trashedAt: null,
    },
    data: {
      trashedAt,
      version: { increment: 1 },
    },
  });
});

test("restore preserves archived state and changes only trashedAt plus version", async (t) => {
  const archivedAt = new Date("2026-08-20T06:00:00.000Z");
  const trashedAt = new Date("2026-08-21T05:00:00.000Z");
  const before = noteRow({ version: 9, archivedAt, trashedAt });
  const after = noteRow({ version: 10, archivedAt, trashedAt: null });

  await assertSimpleMutation({
    t,
    before,
    after,
    invoke: () => restoreNote(USER_ID, NOTE_ID, 9),
    where: {
      id: NOTE_ID,
      userId: USER_ID,
      version: 9,
      purgeRequestedAt: null,
      trashedAt: { not: null },
    },
    data: {
      trashedAt: null,
      version: { increment: 1 },
    },
  });
});

test("trash and restore reject the opposite lifecycle state before mutation", async (t) => {
  const trashed = noteRow({
    id: "already-trashed",
    trashedAt: new Date("2026-08-21T05:00:00.000Z"),
  });
  const active = noteRow({ id: "not-trashed" });
  const harness = serviceHarness(t, {
    noteFindFirst: (args: { where: { id: string } }) =>
      Promise.resolve(args.where.id === trashed.id ? trashed : active),
  });

  await rejectsApi(
    trashNote(USER_ID, trashed.id, 3),
    409,
    "Note state does not allow this operation",
  );
  await rejectsApi(
    restoreNote(USER_ID, active.id, 3),
    409,
    "Note state does not allow this operation",
  );

  assert.equal(harness.transaction.mock.callCount(), 0);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("upload reservation locks the parent and counts pending plus ready images before enforcing the limit", async (t) => {
  const events: string[] = [];
  const now = new Date("2026-08-22T01:00:00.000Z");
  const source = noteRow({ version: 4 });
  const harness = serviceHarness(t, {
    transaction: (callback: TransactionCallback) => {
      events.push("transaction");
      return callback(prisma as unknown as Prisma.TransactionClient);
    },
    queryRaw: () => {
      events.push("parent-lock");
      return Promise.resolve([{ id: NOTE_ID }]);
    },
    noteFindFirst: () => {
      events.push("parent-read");
      return Promise.resolve(mutationState(source));
    },
    imageCount: () => {
      events.push("image-count");
      return Promise.resolve(NOTE_IMAGE_LIMIT);
    },
  });

  await rejectsApi(
    createImageUploadIntent(
      USER_ID,
      NOTE_ID,
      { mimeType: "image/png", sizeBytes: 4096 },
      now,
    ),
    409,
    `A note can contain at most ${NOTE_IMAGE_LIMIT} images`,
  );

  assert.deepEqual(events, [
    "transaction",
    "parent-lock",
    "parent-read",
    "image-count",
  ]);
  const lock = inspectSql(callArgument(harness.queryRaw));
  assert.match(lock.text, /FROM "Note"/);
  assert.match(lock.text, /"id" = \?/);
  assert.match(lock.text, /"userId" = \?/);
  assert.match(lock.text, /FOR UPDATE/);
  assert.deepEqual(lock.values, [NOTE_ID, USER_ID]);
  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.imageCount).where,
    { noteId: NOTE_ID, status: { in: ["PENDING", "READY"] } },
  );
  assert.equal(harness.imageCreate.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("upload intent uses a generated path and persists the provider's actual expiry before returning", async (t) => {
  const now = new Date();
  const provisionalExpiry = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
  const actualExpiry = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const imageId = "image-generated";
  const events: string[] = [];
  const source = noteRow({ version: 11 });
  const harness = serviceHarness(t, {
    transaction: async (callback: TransactionCallback) => {
      events.push("transaction-start");
      const result = await callback(prisma as unknown as Prisma.TransactionClient);
      events.push("transaction-end");
      return result;
    },
    queryRaw: () => {
      events.push("parent-lock");
      return Promise.resolve([{ id: NOTE_ID }]);
    },
    noteFindFirst: () => Promise.resolve(mutationState(source)),
    imageCount: () => Promise.resolve(9),
    imageCreate: () => {
      events.push("reservation-create");
      return Promise.resolve({ id: imageId });
    },
    imageUpdate: (args: { data: { storagePath: string } }) => {
      events.push("path-finalize");
      return Promise.resolve(
        imageRow({
          id: imageId,
          storagePath: args.data.storagePath,
          uploadExpiresAt: provisionalExpiry,
          uploadTokenExpiresAt: provisionalExpiry,
        }),
      );
    },
    createSignedUploadUrl: () => {
      events.push("provider-sign");
      return Promise.resolve({
        signedUrl: "https://storage.example/upload?token=safe",
        expiresAt: actualExpiry,
      });
    },
    imageUpdateMany: () => {
      events.push("expiry-finalize");
      return Promise.resolve({ count: 1 });
    },
  });

  const result = await createImageUploadIntent(
    USER_ID,
    NOTE_ID,
    { mimeType: "image/png", sizeBytes: 4096 },
    now,
  );

  const createArgs = callArgument<{ data: Record<string, unknown> }>(
    harness.imageCreate,
  );
  assert.equal(createArgs.data.noteId, NOTE_ID);
  assert.match(
    createArgs.data.storagePath as string,
    /^reservations\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(createArgs.data, {
    noteId: NOTE_ID,
    storagePath: createArgs.data.storagePath,
    mimeType: "image/png",
    sizeBytes: 4096,
    status: "PENDING",
    position: null,
    uploadExpiresAt: provisionalExpiry,
    uploadTokenExpiresAt: provisionalExpiry,
  });

  const generatedPath = `users/${USER_ID}/notes/${NOTE_ID}/${imageId}.png`;
  const pathUpdate = callArgument<{ where: unknown; data: unknown }>(
    harness.imageUpdate,
  );
  assert.deepEqual(pathUpdate.where, { id: imageId });
  assert.deepEqual(pathUpdate.data, { storagePath: generatedPath });
  assert.equal(
    callArgument<string>(harness.createSignedUploadUrl),
    generatedPath,
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany),
    {
      where: {
        id: imageId,
        noteId: NOTE_ID,
        storagePath: generatedPath,
        status: "PENDING",
        uploadExpiresAt: { not: null },
      },
      data: {
        uploadExpiresAt: actualExpiry,
        uploadTokenExpiresAt: actualExpiry,
      },
    },
  );
  assert.deepEqual(result, {
    imageId,
    uploadUrl: "https://storage.example/upload?token=safe",
    uploadExpiresAt: actualExpiry.toISOString(),
    method: "PUT",
    headers: { "Content-Type": "image/png" },
  });
  assert.equal(harness.transaction.mock.callCount(), 2);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assert.ok(
    events.indexOf("provider-sign") > events.indexOf("transaction-end"),
    "provider signing must occur after the reservation transaction commits",
  );
  assert.ok(
    events.lastIndexOf("transaction-start") > events.indexOf("provider-sign"),
    "actual expiry must be persisted in a second transaction",
  );
});

test("upload signing failure compensates only the matching invisible reservation", async (t) => {
  const now = new Date("2026-08-22T01:00:00.000Z");
  const provisionalExpiry = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
  const imageId = "image-compensated";
  const storagePath = `users/${USER_ID}/notes/${NOTE_ID}/${imageId}.jpg`;
  const source = noteRow({ version: 5 });
  const harness = serviceHarness(t, {
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    noteFindFirst: () => Promise.resolve(mutationState(source)),
    imageCount: () => Promise.resolve(0),
    imageCreate: () => Promise.resolve({ id: imageId }),
    imageUpdate: () =>
      Promise.resolve(
        imageRow({
          id: imageId,
          storagePath,
          mimeType: "image/jpeg",
          uploadExpiresAt: provisionalExpiry,
          uploadTokenExpiresAt: provisionalExpiry,
        }),
      ),
    createSignedUploadUrl: () =>
      Promise.reject(new Error("secret provider failure")),
    imageDeleteMany: () => Promise.resolve({ count: 1 }),
  });

  await rejectsApi(
    createImageUploadIntent(
      USER_ID,
      NOTE_ID,
      { mimeType: "image/jpeg", sizeBytes: 4096 },
      now,
    ),
    503,
    "Storage service unavailable",
  );

  assert.equal(harness.transaction.mock.callCount(), 1);
  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.imageDeleteMany).where,
    {
      id: imageId,
      noteId: NOTE_ID,
      storagePath,
      status: "PENDING",
      uploadExpiresAt: provisionalExpiry,
      uploadTokenExpiresAt: provisionalExpiry,
    },
  );
  assert.equal(harness.imageUpdateMany.mock.callCount(), 0);
  assert.equal(harness.removeObjects.mock.callCount(), 0);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
});

test("metadata mismatch tombstones the pending image without incrementing note version", async (t) => {
  const now = new Date();
  const uploadExpiry = new Date(now.getTime() + 30 * 60 * 1000);
  const tokenExpiry = new Date(now.getTime() + 60 * 60 * 1000);
  const candidate = ownedImageRow({
    uploadExpiresAt: uploadExpiry,
    uploadTokenExpiresAt: tokenExpiry,
    note: noteRow({ version: 6 }),
  });
  const harness = serviceHarness(t, {
    imageFindFirst: () => Promise.resolve(candidate),
    getObjectInfo: () =>
      Promise.resolve({
        size: candidate.sizeBytes + 1,
        contentType: candidate.mimeType,
      }),
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    noteFindFirst: () => Promise.resolve(mutationState(candidate.note)),
    imageUpdateMany: () => Promise.resolve({ count: 1 }),
    removeObjects: () => Promise.resolve(),
  });

  await rejectsApi(
    confirmNoteImage(USER_ID, NOTE_ID, candidate.id, 6, now),
    422,
    "Uploaded image metadata is invalid",
  );

  assert.equal(
    callArgument<string>(harness.getObjectInfo),
    candidate.storagePath,
  );
  assert.equal(harness.imageFindFirst.mock.callCount(), 2);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany),
    {
      where: { id: candidate.id, noteId: NOTE_ID, status: "PENDING" },
      data: {
        status: "DELETE_PENDING",
        position: null,
        uploadExpiresAt: null,
        updatedAt: new Date(
          tokenExpiry.getTime() + UPLOAD_TOKEN_REPLAY_GRACE_MS,
        ),
      },
    },
  );
  assert.deepEqual(
    callArgument<string[]>(harness.removeObjects),
    [candidate.storagePath],
  );
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assert.equal(harness.noteUpdate.mock.callCount(), 0);
  assert.equal(harness.createSignedReadUrls.mock.callCount(), 0);
});

test("valid confirmation promotes with a post-lock wall-clock SQL predicate and increments once", async (t) => {
  const now = new Date();
  const existing = readyImage({ id: "image-ready", position: 4 });
  const candidate = ownedImageRow({
    id: "image-candidate",
    storagePath: `users/${USER_ID}/notes/${NOTE_ID}/image-candidate.webp`,
    mimeType: "image/webp",
    sizeBytes: 8192,
    uploadExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    uploadTokenExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    note: noteRow({ version: 12, images: [existing] }),
  });
  const after = noteRow({
    version: 13,
    images: [
      { ...existing, position: 0 },
      readyImage({
        id: candidate.id,
        storagePath: candidate.storagePath,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        position: 1,
      }),
    ],
  });
  const events: string[] = [];
  let noteReads = 0;
  const harness = serviceHarness(t, {
    imageFindFirst: () => Promise.resolve(candidate),
    getObjectInfo: () => {
      events.push("metadata");
      return Promise.resolve({
        size: candidate.sizeBytes,
        contentType: candidate.mimeType,
      });
    },
    createSignedReadUrls: (paths: string[]) => {
      events.push("sign");
      return Promise.resolve(
        new Map(paths.map((path) => [path, `https://signed.example/${path}`])),
      );
    },
    queryRaw: (query: unknown) => {
      const sql = inspectSql(query);
      if (sql.text.includes("FOR UPDATE")) {
        events.push("parent-lock");
        return Promise.resolve([{ id: NOTE_ID }]);
      }
      events.push("promotion-sql");
      return Promise.resolve([{ id: candidate.id }]);
    },
    noteFindFirst: () => {
      noteReads += 1;
      return Promise.resolve(
        noteReads === 1 ? mutationState(candidate.note) : after,
      );
    },
    imageFindMany: () =>
      Promise.resolve([{ id: existing.id, position: existing.position }]),
    imageUpdateMany: () => {
      events.push("normalize-position");
      return Promise.resolve({ count: 1 });
    },
    noteUpdateMany: () => {
      events.push("version-cas");
      return Promise.resolve({ count: 1 });
    },
  });

  const result = await confirmNoteImage(
    USER_ID,
    NOTE_ID,
    candidate.id,
    12,
    now,
  );

  assert.equal(result.version, 13);
  assert.deepEqual(
    result.images.map((image) => [image.id, image.position]),
    [
      [existing.id, 0],
      [candidate.id, 1],
    ],
  );
  assert.deepEqual(
    callArgument<string[]>(harness.createSignedReadUrls),
    [existing.storagePath, candidate.storagePath],
  );
  assert.equal(harness.queryRaw.mock.callCount(), 2);
  const promotion = inspectSql(callArgument(harness.queryRaw, 1));
  assert.match(promotion.text, /WITH db_clock AS/);
  assert.match(promotion.text, /SELECT clock_timestamp\(\) AS checked_at/);
  assert.match(
    promotion.text,
    /"uploadExpiresAt" > db_clock\.checked_at/,
  );
  assert.doesNotMatch(promotion.text, /CURRENT_TIMESTAMP|transaction_timestamp/);
  assert.equal(
    (promotion.text.match(/clock_timestamp\(\)/g) ?? []).length,
    1,
  );
  assert.deepEqual(promotion.values, [
    "READY",
    1,
    candidate.id,
    NOTE_ID,
    "PENDING",
  ]);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany),
    {
      where: { id: existing.id, noteId: NOTE_ID, status: "READY" },
      data: { position: 0 },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    {
      where: {
        id: NOTE_ID,
        userId: USER_ID,
        version: 12,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    },
  );
  assert.ok(events.indexOf("sign") < events.indexOf("parent-lock"));
  assert.ok(events.indexOf("parent-lock") < events.indexOf("promotion-sql"));
  assert.ok(events.indexOf("promotion-sql") < events.indexOf("version-cas"));
  assert.equal(harness.removeObjects.mock.callCount(), 0);
});

test("confirmation version race leaves the candidate pending and never reaches promotion SQL", async (t) => {
  const now = new Date();
  const candidate = ownedImageRow({
    id: "image-raced",
    uploadExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    uploadTokenExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    note: noteRow({ version: 20 }),
  });
  const harness = serviceHarness(t, {
    imageFindFirst: () => Promise.resolve(candidate),
    getObjectInfo: () =>
      Promise.resolve({
        size: candidate.sizeBytes,
        contentType: candidate.mimeType,
      }),
    createSignedReadUrls: (paths: string[]) =>
      Promise.resolve(new Map(paths.map((path) => [path, "https://signed.example/race"]))),
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    noteFindFirst: () =>
      Promise.resolve(
        mutationState(noteRow({ version: 21 })),
      ),
  });

  await rejectsApi(
    confirmNoteImage(USER_ID, NOTE_ID, candidate.id, 20, now),
    412,
    "Note version does not match If-Match",
  );

  assert.equal(harness.queryRaw.mock.callCount(), 1);
  assert.match(inspectSql(callArgument(harness.queryRaw)).text, /FOR UPDATE/);
  assert.equal(harness.imageFindFirst.mock.callCount(), 1);
  assert.equal(harness.imageFindMany.mock.callCount(), 0);
  assert.equal(harness.imageUpdateMany.mock.callCount(), 0);
  assert.equal(harness.noteUpdateMany.mock.callCount(), 0);
  assert.equal(harness.removeObjects.mock.callCount(), 0);
});

test("reorder rejects a missing or foreign supplied image before signing", async (t) => {
  const first = readyImage({ id: "image-one" });
  const second = readyImage({ id: "image-two", position: 1 });
  const harness = serviceHarness(t, {
    noteFindFirst: () =>
      Promise.resolve(noteRow({ version: 5, images: [first, second] })),
    imageFindMany: () =>
      Promise.resolve([{ id: first.id, status: "READY" }]),
  });

  await rejectsApi(
    reorderNoteImages(
      USER_ID,
      NOTE_ID,
      { imageIds: [first.id, "foreign-image"] },
      5,
    ),
    404,
    "Note image not found",
  );

  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.imageFindMany).where,
    {
      id: { in: [first.id, "foreign-image"] },
      noteId: NOTE_ID,
      note: {
        is: { id: NOTE_ID, userId: USER_ID, purgeRequestedAt: null },
      },
    },
  );
  assert.equal(harness.transaction.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("reorder rejects pending images before signing", async (t) => {
  const image = readyImage({ id: "image-pending" });
  const harness = serviceHarness(t, {
    noteFindFirst: () =>
      Promise.resolve(noteRow({ version: 5, images: [image] })),
    imageFindMany: () =>
      Promise.resolve([{ id: image.id, status: "PENDING" }]),
  });

  await rejectsApi(
    reorderNoteImages(USER_ID, NOTE_ID, { imageIds: [image.id] }, 5),
    409,
    "Note image state does not allow this operation",
  );

  assert.equal(harness.transaction.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("reorder rejects an incomplete ready-image permutation before signing", async (t) => {
  const first = readyImage({ id: "image-one" });
  const second = readyImage({ id: "image-two", position: 1 });
  const harness = serviceHarness(t, {
    noteFindFirst: () =>
      Promise.resolve(noteRow({ version: 5, images: [first, second] })),
    imageFindMany: () =>
      Promise.resolve([{ id: first.id, status: "READY" }]),
  });

  await rejectsApi(
    reorderNoteImages(USER_ID, NOTE_ID, { imageIds: [first.id] }, 5),
    409,
    "imageIds must contain every ready image",
  );

  assert.equal(harness.transaction.mock.callCount(), 0);
  assertNoStorageCalls(harness);
});

test("reorder revalidates under the parent lock, writes every requested position, and increments once", async (t) => {
  const first = readyImage({
    id: "image-one",
    storagePath: "path/image-one",
    position: 0,
  });
  const second = readyImage({
    id: "image-two",
    storagePath: "path/image-two",
    position: 1,
  });
  const before = noteRow({ version: 30, images: [first, second] });
  const after = noteRow({
    version: 31,
    images: [
      { ...second, position: 0 },
      { ...first, position: 1 },
    ],
  });
  let noteReads = 0;
  let imageReads = 0;
  const harness = serviceHarness(t, {
    noteFindFirst: () => {
      noteReads += 1;
      if (noteReads === 1) return Promise.resolve(before);
      if (noteReads === 2) return Promise.resolve(mutationState(before));
      return Promise.resolve(after);
    },
    imageFindMany: () => {
      imageReads += 1;
      if (imageReads <= 2) {
        return Promise.resolve([
          { id: first.id, status: "READY" },
          { id: second.id, status: "READY" },
        ]);
      }
      return Promise.resolve([{ id: first.id }, { id: second.id }]);
    },
    createSignedReadUrls: (paths: string[]) =>
      Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}`]))),
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    imageUpdateMany: () => Promise.resolve({ count: 1 }),
    noteUpdateMany: () => Promise.resolve({ count: 1 }),
  });

  const result = await reorderNoteImages(
    USER_ID,
    NOTE_ID,
    { imageIds: [second.id, first.id] },
    30,
  );

  assert.equal(result.version, 31);
  assert.deepEqual(
    result.images.map((image) => [image.id, image.position]),
    [
      [second.id, 0],
      [first.id, 1],
    ],
  );
  assert.equal(harness.imageFindMany.mock.callCount(), 3);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany, 0),
    {
      where: { id: second.id, noteId: NOTE_ID, status: "READY" },
      data: { position: 0 },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany, 1),
    {
      where: { id: first.id, noteId: NOTE_ID, status: "READY" },
      data: { position: 1 },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    {
      where: {
        id: NOTE_ID,
        userId: USER_ID,
        version: 30,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    },
  );
  assert.equal(harness.transaction.mock.callCount(), 1);
});

test("image delete tombstones the target, compacts positions, and ignores post-commit provider failure", async (t) => {
  const now = new Date("2026-08-22T08:00:00.000Z");
  const tokenExpiry = new Date("2026-08-22T09:00:00.000Z");
  const targetReady = readyImage({
    id: "image-target",
    storagePath: "path/target",
    position: 0,
  });
  const second = readyImage({
    id: "image-second",
    storagePath: "path/second",
    position: 4,
  });
  const third = readyImage({
    id: "image-third",
    storagePath: "path/third",
    position: 7,
  });
  const before = noteRow({
    version: 40,
    images: [targetReady, second, third],
  });
  const target = ownedImageRow({
    id: targetReady.id,
    storagePath: targetReady.storagePath,
    position: targetReady.position,
    status: "READY",
    uploadExpiresAt: null,
    uploadTokenExpiresAt: tokenExpiry,
    note: before,
  });
  const after = noteRow({
    version: 41,
    images: [
      { ...second, position: 0 },
      { ...third, position: 1 },
    ],
  });
  const events: string[] = [];
  let noteReads = 0;
  const harness = serviceHarness(t, {
    transaction: async (callback: TransactionCallback) => {
      events.push("transaction-start");
      const result = await callback(prisma as unknown as Prisma.TransactionClient);
      events.push("transaction-commit");
      return result;
    },
    imageFindFirst: () => Promise.resolve(target),
    createSignedReadUrls: (paths: string[]) => {
      events.push("sign-remaining");
      return Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}`])));
    },
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    noteFindFirst: () => {
      noteReads += 1;
      return Promise.resolve(noteReads === 1 ? mutationState(before) : after);
    },
    imageFindMany: () =>
      Promise.resolve([
        { id: targetReady.id, position: targetReady.position },
        { id: second.id, position: second.position },
        { id: third.id, position: third.position },
      ]),
    imageUpdateMany: () => Promise.resolve({ count: 1 }),
    noteUpdateMany: () => Promise.resolve({ count: 1 }),
    removeObjects: () => {
      events.push("provider-remove-failed");
      return Promise.reject(new Error("provider unavailable"));
    },
  });

  const result = await deleteNoteImage(
    USER_ID,
    NOTE_ID,
    target.id,
    40,
    now,
  );

  assert.equal(result.version, 41);
  assert.deepEqual(
    result.images.map((image) => [image.id, image.position]),
    [
      [second.id, 0],
      [third.id, 1],
    ],
  );
  assert.deepEqual(
    callArgument<string[]>(harness.createSignedReadUrls),
    [second.storagePath, third.storagePath],
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany, 0),
    {
      where: { id: target.id, noteId: NOTE_ID, status: "READY" },
      data: {
        status: "DELETE_PENDING",
        position: null,
        uploadExpiresAt: null,
        updatedAt: new Date(
          tokenExpiry.getTime() + UPLOAD_TOKEN_REPLAY_GRACE_MS,
        ),
      },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany, 1),
    {
      where: { id: second.id, noteId: NOTE_ID, status: "READY" },
      data: { position: 0 },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany, 2),
    {
      where: { id: third.id, noteId: NOTE_ID, status: "READY" },
      data: { position: 1 },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    {
      where: {
        id: NOTE_ID,
        userId: USER_ID,
        version: 40,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    },
  );
  assert.deepEqual(
    callArgument<string[]>(harness.removeObjects),
    [target.storagePath],
  );
  assert.ok(
    events.indexOf("provider-remove-failed") >
      events.indexOf("transaction-commit"),
  );
});

test("manual permanent delete claims once and reuses the bounded purge routine", async (t) => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const trashedAt = new Date("2026-08-20T10:00:00.000Z");
  const before = noteRow({ version: 50, trashedAt, images: [] });
  let noteReads = 0;
  const harness = serviceHarness(t, {
    queryRaw: () => Promise.resolve([{ id: NOTE_ID }]),
    noteFindFirst: () => {
      noteReads += 1;
      return Promise.resolve(
        noteReads === 1 ? before : mutationState(before),
      );
    },
    noteUpdateMany: () => Promise.resolve({ count: 1 }),
    imageUpdateMany: () => Promise.resolve({ count: 0 }),
    imageAggregate: () =>
      Promise.resolve({
        _count: { _all: 0 },
        _max: { uploadTokenExpiresAt: null },
        _min: { updatedAt: null },
      }),
    noteDeleteMany: () => Promise.resolve({ count: 1 }),
  });

  const result = await permanentlyDeleteNote(USER_ID, NOTE_ID, 50, now);

  assert.equal(result, undefined);
  assert.equal(harness.transaction.mock.callCount(), 2);
  assert.equal(harness.queryRaw.mock.callCount(), 2);
  const claimLock = inspectSql(callArgument(harness.queryRaw, 0));
  assert.match(claimLock.text, /"userId" = \?/);
  assert.deepEqual(claimLock.values, [NOTE_ID, USER_ID]);
  const purgeLock = inspectSql(callArgument(harness.queryRaw, 1));
  assert.match(purgeLock.text, /"purgeRequestedAt" IS NOT NULL/);
  assert.deepEqual(purgeLock.values, [NOTE_ID]);
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.noteUpdateMany),
    {
      where: {
        id: NOTE_ID,
        userId: USER_ID,
        version: 50,
        purgeRequestedAt: null,
        trashedAt: { not: null },
      },
      data: {
        purgeRequestedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown; data: unknown }>(harness.imageUpdateMany),
    {
      where: { noteId: NOTE_ID, status: { in: ["PENDING", "READY"] } },
      data: {
        status: "DELETE_PENDING",
        position: null,
        uploadExpiresAt: null,
        updatedAt: now,
      },
    },
  );
  assert.deepEqual(
    callArgument<{ where: unknown }>(harness.noteDeleteMany).where,
    {
      id: NOTE_ID,
      purgeRequestedAt: { not: null },
      images: { none: {} },
    },
  );
  assertNoStorageCalls(harness);
});
