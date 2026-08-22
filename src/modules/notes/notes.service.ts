import { randomUUID } from "node:crypto";
import {
  Prisma,
  type NoteImageStatus,
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { purgeClaimedNote } from "./notes.cleanup";
import { storageAdapter, type StorageObjectInfo } from "./notes.storage";
import {
  NOTE_IMAGE_EXTENSION_BY_MIME_TYPE,
  NOTE_IMAGE_LIMIT,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_IMAGE_MIME_TYPES,
  UPLOAD_INTENT_TTL_MS,
  UPLOAD_TOKEN_REPLAY_GRACE_MS,
  type NoteImageUploadIntentResponse,
  type NoteListPage,
  type NoteResponse,
} from "./notes.types";
import {
  encodeNoteCursor,
  type CreateNoteInput,
  type ImageOrderInput,
  type ParsedListNotesQuery,
  type PatchNoteInput,
  type UploadIntentInput,
} from "./notes.validation";

const readyImageSelect = {
  id: true,
  storagePath: true,
  mimeType: true,
  sizeBytes: true,
  position: true,
} satisfies Prisma.NoteImageSelect;

const noteResponseSelect = {
  id: true,
  title: true,
  content: true,
  color: true,
  isPinned: true,
  archivedAt: true,
  trashedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  images: {
    where: { status: "READY" },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: readyImageSelect,
  },
} satisfies Prisma.NoteSelect;

const noteMutationStateSelect = {
  id: true,
  version: true,
  archivedAt: true,
  trashedAt: true,
  purgeRequestedAt: true,
} satisfies Prisma.NoteSelect;

const internalImageSelect = {
  id: true,
  noteId: true,
  storagePath: true,
  mimeType: true,
  sizeBytes: true,
  position: true,
  status: true,
  uploadExpiresAt: true,
  uploadTokenExpiresAt: true,
  updatedAt: true,
} satisfies Prisma.NoteImageSelect;

const ownedImageWithNoteSelect = {
  ...internalImageSelect,
  note: { select: noteResponseSelect },
} satisfies Prisma.NoteImageSelect;

type SelectedNote = Prisma.NoteGetPayload<{ select: typeof noteResponseSelect }>;
type MutationState = Prisma.NoteGetPayload<{
  select: typeof noteMutationStateSelect;
}>;
type InternalImage = Prisma.NoteImageGetPayload<{
  select: typeof internalImageSelect;
}>;
type OwnedImageWithNote = Prisma.NoteImageGetPayload<{
  select: typeof ownedImageWithNoteSelect;
}>;

type SignedReads = {
  urlsByPath: Map<string, string>;
  expiresAt: string | null;
};

function noteNotFound(): ApiError {
  return new ApiError("Note not found", 404);
}

function imageNotFound(): ApiError {
  return new ApiError("Note image not found", 404);
}

function versionMismatch(): ApiError {
  return new ApiError("Note version does not match If-Match", 412);
}

function invalidNoteState(): ApiError {
  return new ApiError("Note state does not allow this operation", 409);
}

function invalidImageState(): ApiError {
  return new ApiError("Note image state does not allow this operation", 409);
}

function storageUnavailable(): ApiError {
  return new ApiError("Storage service unavailable", 503);
}

function invalidStoredNote(): never {
  throw new Error("Stored note data violates Notes invariants");
}

function safeDeleteAt(uploadTokenExpiresAt: Date): Date {
  return new Date(
    uploadTokenExpiresAt.getTime() + UPLOAD_TOKEN_REPLAY_GRACE_MS,
  );
}

function tombstoneDueAt(uploadTokenExpiresAt: Date, now: Date): Date {
  const safeAt = safeDeleteAt(uploadTokenExpiresAt);
  return safeAt > now ? safeAt : now;
}

async function signPaths(paths: readonly string[]): Promise<SignedReads> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return { urlsByPath: new Map(), expiresAt: null };
  }

  const signedAt = new Date();
  try {
    const ttlMs = env.NOTE_IMAGE_READ_URL_TTL_MS;
    const urlsByPath = await storageAdapter.createSignedReadUrls(uniquePaths);
    for (const path of uniquePaths) {
      if (!urlsByPath.has(path)) throw storageUnavailable();
    }
    return {
      urlsByPath,
      expiresAt: new Date(signedAt.getTime() + ttlMs).toISOString(),
    };
  } catch {
    throw storageUnavailable();
  }
}

async function signNotes(notes: readonly SelectedNote[]): Promise<SignedReads> {
  return signPaths(
    notes.flatMap((note) => note.images.map((image) => image.storagePath)),
  );
}

function mapNote(note: SelectedNote, signed: SignedReads): NoteResponse {
  const images = note.images.map((image) => {
    if (image.position === null || signed.expiresAt === null) {
      return invalidStoredNote();
    }
    const url = signed.urlsByPath.get(image.storagePath);
    if (url === undefined) throw storageUnavailable();

    return {
      id: image.id,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      position: image.position,
      url,
      urlExpiresAt: signed.expiresAt,
    };
  });

  return {
    id: note.id,
    title: note.title,
    content: note.content,
    color: note.color,
    isPinned: note.isPinned,
    archivedAt: note.archivedAt?.toISOString() ?? null,
    trashedAt: note.trashedAt?.toISOString() ?? null,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    images,
  };
}

async function mapNotes(notes: readonly SelectedNote[]): Promise<NoteResponse[]> {
  const signed = await signNotes(notes);
  return notes.map((note) => mapNote(note, signed));
}

async function findOwnedNote(
  userId: string,
  noteId: string,
): Promise<SelectedNote> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId, purgeRequestedAt: null },
    select: noteResponseSelect,
  });
  if (!note) throw noteNotFound();
  return note;
}

async function findOwnedImageWithNote(
  userId: string,
  noteId: string,
  imageId: string,
): Promise<OwnedImageWithNote> {
  const image = await prisma.noteImage.findFirst({
    where: {
      id: imageId,
      noteId,
      note: { is: { id: noteId, userId, purgeRequestedAt: null } },
    },
    select: ownedImageWithNoteSelect,
  });
  if (!image) throw imageNotFound();
  return image;
}

function assertExpectedVersion(note: { version: number }, expectedVersion: number): void {
  if (note.version !== expectedVersion) throw versionMismatch();
}

function assertUntrashed(note: { trashedAt: Date | null }): void {
  if (note.trashedAt !== null) throw invalidNoteState();
}

async function classifyCasFailure(
  tx: Prisma.TransactionClient,
  userId: string,
  noteId: string,
  expectedVersion: number,
): Promise<never> {
  const note = await tx.note.findFirst({
    where: { id: noteId, userId },
    select: { version: true, purgeRequestedAt: true },
  });
  if (!note || note.purgeRequestedAt !== null) throw noteNotFound();
  if (note.version !== expectedVersion) throw versionMismatch();
  throw invalidNoteState();
}

async function lockOwnedNote(
  tx: Prisma.TransactionClient,
  userId: string,
  noteId: string,
): Promise<MutationState> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Note" WHERE "id" = ${noteId} AND "userId" = ${userId} FOR UPDATE`,
  );
  if (locked.length === 0) throw noteNotFound();

  const note = await tx.note.findFirst({
    where: { id: noteId, userId },
    select: noteMutationStateSelect,
  });
  if (!note || note.purgeRequestedAt !== null) throw noteNotFound();
  return note;
}

type SimpleMutationOptions = {
  lifecycleWhere: Prisma.NoteWhereInput;
  data: Prisma.NoteUpdateManyMutationInput;
  validate: (note: SelectedNote) => void;
};

async function mutateNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
  options: SimpleMutationOptions,
): Promise<NoteResponse> {
  const before = await findOwnedNote(userId, noteId);
  assertExpectedVersion(before, expectedVersion);
  options.validate(before);

  const signed = await signNotes([before]);
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.note.updateMany({
      where: {
        id: noteId,
        userId,
        version: expectedVersion,
        purgeRequestedAt: null,
        ...options.lifecycleWhere,
      },
      data: {
        ...options.data,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      return classifyCasFailure(tx, userId, noteId, expectedVersion);
    }

    const note = await tx.note.findFirst({
      where: { id: noteId, userId, purgeRequestedAt: null },
      select: noteResponseSelect,
    });
    if (!note) throw noteNotFound();
    return note;
  });

  return mapNote(after, signed);
}

function olderTimestampWhere(
  field: "updatedAt" | "trashedAt",
  timestamp: Date,
  id: string,
): Prisma.NoteWhereInput {
  return {
    OR: [
      { [field]: { lt: timestamp } },
      { [field]: timestamp, id: { lt: id } },
    ],
  };
}

function activeCursorWhere(
  cursor: Extract<ParsedListNotesQuery, { view: "active" }> ["cursor"],
): Prisma.NoteWhereInput | undefined {
  if (cursor === null) return undefined;
  const older = olderTimestampWhere(
    "updatedAt",
    new Date(cursor.updatedAt),
    cursor.id,
  );

  if (!cursor.isPinned) {
    return { isPinned: false, ...older };
  }
  return {
    OR: [
      { isPinned: true, ...older },
      { isPinned: false },
    ],
  };
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponse> {
  const note = await prisma.note.create({
    data: {
      userId,
      title: input.title ?? "",
      content: input.content ?? "",
      color: input.color ?? "DEFAULT",
    },
    select: noteResponseSelect,
  });
  return mapNote(note, { urlsByPath: new Map(), expiresAt: null });
}

export async function listNotes(
  userId: string,
  query: ParsedListNotesQuery,
): Promise<NoteListPage> {
  let rows: SelectedNote[];

  switch (query.view) {
    case "active":
      rows = await prisma.note.findMany({
        where: {
          userId,
          purgeRequestedAt: null,
          trashedAt: null,
          archivedAt: null,
          AND: activeCursorWhere(query.cursor),
        },
        orderBy: [
          { isPinned: "desc" },
          { updatedAt: "desc" },
          { id: "desc" },
        ],
        take: query.limit + 1,
        select: noteResponseSelect,
      });
      break;
    case "archived":
      rows = await prisma.note.findMany({
        where: {
          userId,
          purgeRequestedAt: null,
          trashedAt: null,
          archivedAt: { not: null },
          AND:
            query.cursor === null
              ? undefined
              : olderTimestampWhere(
                  "updatedAt",
                  new Date(query.cursor.updatedAt),
                  query.cursor.id,
                ),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: noteResponseSelect,
      });
      break;
    case "trash":
      rows = await prisma.note.findMany({
        where: {
          userId,
          purgeRequestedAt: null,
          trashedAt: { not: null },
          AND:
            query.cursor === null
              ? undefined
              : olderTimestampWhere(
                  "trashedAt",
                  new Date(query.cursor.trashedAt),
                  query.cursor.id,
                ),
        },
        orderBy: [{ trashedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: noteResponseSelect,
      });
      break;
  }

  const pageRows = rows.slice(0, query.limit);
  const notes = await mapNotes(pageRows);
  let nextCursor: string | null = null;
  if (rows.length > query.limit) {
    const last = pageRows.at(-1);
    if (!last) return invalidStoredNote();
    switch (query.view) {
      case "active":
        nextCursor = encodeNoteCursor({
          view: "active",
          isPinned: last.isPinned,
          updatedAt: last.updatedAt.toISOString(),
          id: last.id,
        });
        break;
      case "archived":
        nextCursor = encodeNoteCursor({
          view: "archived",
          updatedAt: last.updatedAt.toISOString(),
          id: last.id,
        });
        break;
      case "trash":
        if (last.trashedAt === null) return invalidStoredNote();
        nextCursor = encodeNoteCursor({
          view: "trash",
          trashedAt: last.trashedAt.toISOString(),
          id: last.id,
        });
        break;
    }
  }

  return { notes, nextCursor };
}

export async function getNote(
  userId: string,
  noteId: string,
): Promise<NoteResponse> {
  const note = await findOwnedNote(userId, noteId);
  const [response] = await mapNotes([note]);
  if (!response) return invalidStoredNote();
  return response;
}

export async function patchNote(
  userId: string,
  noteId: string,
  input: PatchNoteInput,
  expectedVersion: number,
): Promise<NoteResponse> {
  const data: Prisma.NoteUpdateManyMutationInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.content !== undefined) data.content = input.content;
  if (input.color !== undefined) data.color = input.color;
  if (input.isPinned !== undefined) data.isPinned = input.isPinned;

  return mutateNote(userId, noteId, expectedVersion, {
    lifecycleWhere: {
      trashedAt: null,
      ...(input.isPinned === true ? { archivedAt: null } : {}),
    },
    data,
    validate: (note) => {
      assertUntrashed(note);
      if (input.isPinned === true && note.archivedAt !== null) {
        throw invalidNoteState();
      }
    },
  });
}

export async function archiveNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<NoteResponse> {
  return mutateNote(userId, noteId, expectedVersion, {
    lifecycleWhere: { trashedAt: null, archivedAt: null },
    data: { archivedAt: now, isPinned: false },
    validate: (note) => {
      assertUntrashed(note);
      if (note.archivedAt !== null) throw invalidNoteState();
    },
  });
}

export async function unarchiveNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
): Promise<NoteResponse> {
  return mutateNote(userId, noteId, expectedVersion, {
    lifecycleWhere: { trashedAt: null, archivedAt: { not: null } },
    data: { archivedAt: null },
    validate: (note) => {
      assertUntrashed(note);
      if (note.archivedAt === null) throw invalidNoteState();
    },
  });
}

export async function trashNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<NoteResponse> {
  return mutateNote(userId, noteId, expectedVersion, {
    lifecycleWhere: { trashedAt: null },
    data: { trashedAt: now },
    validate: assertUntrashed,
  });
}

export async function restoreNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
): Promise<NoteResponse> {
  return mutateNote(userId, noteId, expectedVersion, {
    lifecycleWhere: { trashedAt: { not: null } },
    data: { trashedAt: null },
    validate: (note) => {
      if (note.trashedAt === null) throw invalidNoteState();
    },
  });
}

async function markUploadTombstone(
  tx: Prisma.TransactionClient,
  image: Pick<InternalImage, "id" | "noteId" | "storagePath">,
  uploadTokenExpiresAt: Date,
  now: Date,
): Promise<void> {
  await tx.noteImage.updateMany({
    where: {
      id: image.id,
      noteId: image.noteId,
      storagePath: image.storagePath,
      status: { in: ["PENDING", "DELETE_PENDING"] },
    },
    data: {
      status: "DELETE_PENDING",
      position: null,
      uploadExpiresAt: null,
      uploadTokenExpiresAt,
      updatedAt: tombstoneDueAt(uploadTokenExpiresAt, now),
    },
  });
}

async function removeWithoutThrowing(path: string): Promise<void> {
  try {
    await storageAdapter.removeObjects([path]);
  } catch {
    // The replay tombstone remains discoverable for cleanup.
  }
}

export async function createImageUploadIntent(
  userId: string,
  noteId: string,
  input: UploadIntentInput,
  now = new Date(),
): Promise<NoteImageUploadIntentResponse> {
  const provisionalExpiry = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
  const reservation = await prisma.$transaction(async (tx) => {
    const note = await lockOwnedNote(tx, userId, noteId);
    assertUntrashed(note);

    const imageCount = await tx.noteImage.count({
      where: { noteId, status: { in: ["PENDING", "READY"] } },
    });
    if (imageCount >= NOTE_IMAGE_LIMIT) {
      throw new ApiError(
        `A note can contain at most ${NOTE_IMAGE_LIMIT} images`,
        409,
      );
    }

    const created = await tx.noteImage.create({
      data: {
        noteId,
        storagePath: `reservations/${randomUUID()}`,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: "PENDING",
        position: null,
        uploadExpiresAt: provisionalExpiry,
        uploadTokenExpiresAt: provisionalExpiry,
      },
      select: { id: true },
    });
    const storagePath = `users/${userId}/notes/${noteId}/${created.id}.${NOTE_IMAGE_EXTENSION_BY_MIME_TYPE[input.mimeType]}`;
    return tx.noteImage.update({
      where: { id: created.id },
      data: { storagePath },
      select: internalImageSelect,
    });
  });

  let signedUpload: Awaited<
    ReturnType<typeof storageAdapter.createSignedUploadUrl>
  >;
  try {
    signedUpload = await storageAdapter.createSignedUploadUrl(
      reservation.storagePath,
    );
  } catch {
    try {
      await prisma.noteImage.deleteMany({
        where: {
          id: reservation.id,
          noteId,
          storagePath: reservation.storagePath,
          status: "PENDING",
          uploadExpiresAt: provisionalExpiry,
          uploadTokenExpiresAt: provisionalExpiry,
        },
      });
    } catch {
      // Cleanup will claim an uncompensated provisional reservation.
    }
    throw storageUnavailable();
  }

  const actualExpiry = signedUpload.expiresAt;
  const finalizedAt = new Date();
  const validActualExpiry =
    actualExpiry instanceof Date &&
    Number.isFinite(actualExpiry.getTime()) &&
    actualExpiry > finalizedAt;

  let disposition: "ready" | "not-found" | "conflict" | "invalid-expiry";
  try {
    disposition = await prisma.$transaction(async (tx) => {
      let note: MutationState | null = null;
      try {
        note = await lockOwnedNote(tx, userId, noteId);
      } catch (error) {
        if (!(error instanceof ApiError) || error.statusCode !== 404) throw error;
      }

      if (!validActualExpiry) {
        await markUploadTombstone(
          tx,
          reservation,
          actualExpiry,
          finalizedAt,
        );
        return "invalid-expiry";
      }
      if (!note) {
        await markUploadTombstone(
          tx,
          reservation,
          actualExpiry,
          finalizedAt,
        );
        return "not-found";
      }
      if (note.trashedAt !== null) {
        await markUploadTombstone(
          tx,
          reservation,
          actualExpiry,
          finalizedAt,
        );
        return "conflict";
      }

      const updated = await tx.noteImage.updateMany({
        where: {
          id: reservation.id,
          noteId,
          storagePath: reservation.storagePath,
          status: "PENDING",
          uploadExpiresAt: { not: null },
        },
        data: {
          uploadExpiresAt: actualExpiry,
          uploadTokenExpiresAt: actualExpiry,
        },
      });
      if (updated.count === 1) return "ready";

      await markUploadTombstone(
        tx,
        reservation,
        actualExpiry,
        finalizedAt,
      );
      return "conflict";
    });
  } catch (error) {
    try {
      await prisma.$transaction((tx) =>
        markUploadTombstone(
          tx,
          reservation,
          actualExpiry,
          finalizedAt,
        ),
      );
    } catch {
      // The provisional row remains available to cleanup if the database is down.
    }
    await removeWithoutThrowing(reservation.storagePath);
    throw error;
  }

  if (disposition !== "ready") {
    await removeWithoutThrowing(reservation.storagePath);
    if (disposition === "not-found") throw noteNotFound();
    if (disposition === "invalid-expiry") throw storageUnavailable();
    throw invalidNoteState();
  }

  return {
    imageId: reservation.id,
    uploadUrl: signedUpload.signedUrl,
    uploadExpiresAt: actualExpiry.toISOString(),
    method: "PUT",
    headers: { "Content-Type": input.mimeType },
  };
}

function isValidObjectMetadata(
  info: StorageObjectInfo | null,
  image: Pick<InternalImage, "mimeType" | "sizeBytes">,
): boolean {
  return (
    info !== null &&
    typeof info.size === "number" &&
    Number.isSafeInteger(info.size) &&
    info.size > 0 &&
    info.size <= NOTE_IMAGE_MAX_BYTES &&
    info.size === image.sizeBytes &&
    typeof info.contentType === "string" &&
    (NOTE_IMAGE_MIME_TYPES as readonly string[]).includes(info.contentType) &&
    info.contentType === image.mimeType
  );
}

async function getObjectInfo(path: string): Promise<StorageObjectInfo | null> {
  try {
    return await storageAdapter.getObjectInfo(path);
  } catch {
    throw storageUnavailable();
  }
}

async function tombstoneInvalidConfirmation(
  userId: string,
  noteId: string,
  imageId: string,
  expectedVersion: number,
  now: Date,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const note = await lockOwnedNote(tx, userId, noteId);
    assertExpectedVersion(note, expectedVersion);
    assertUntrashed(note);

    const image = await tx.noteImage.findFirst({
      where: {
        id: imageId,
        noteId,
        note: { is: { id: noteId, userId, purgeRequestedAt: null } },
      },
      select: internalImageSelect,
    });
    if (!image) throw imageNotFound();
    if (image.status !== "PENDING") throw invalidImageState();

    const updated = await tx.noteImage.updateMany({
      where: { id: imageId, noteId, status: "PENDING" },
      data: {
        status: "DELETE_PENDING",
        position: null,
        uploadExpiresAt: null,
        updatedAt: tombstoneDueAt(image.uploadTokenExpiresAt, now),
      },
    });
    if (updated.count === 0) throw invalidImageState();
    return image.storagePath;
  });
}

async function normalizeReadyPositions(
  tx: Prisma.TransactionClient,
  noteId: string,
  images: ReadonlyArray<{ id: string; position: number | null }>,
): Promise<void> {
  for (const [position, image] of images.entries()) {
    if (image.position === position) continue;
    const updated = await tx.noteImage.updateMany({
      where: { id: image.id, noteId, status: "READY" },
      data: { position },
    });
    if (updated.count === 0) throw invalidImageState();
  }
}

export async function confirmNoteImage(
  userId: string,
  noteId: string,
  imageId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<NoteResponse> {
  const candidate = await findOwnedImageWithNote(userId, noteId, imageId);
  assertExpectedVersion(candidate.note, expectedVersion);
  assertUntrashed(candidate.note);
  if (
    candidate.status !== "PENDING" ||
    candidate.uploadExpiresAt === null ||
    candidate.uploadExpiresAt <= now
  ) {
    throw new ApiError("Upload intent is expired or unavailable", 409);
  }

  const metadata = await getObjectInfo(candidate.storagePath);
  if (!isValidObjectMetadata(metadata, candidate)) {
    const path = await tombstoneInvalidConfirmation(
      userId,
      noteId,
      imageId,
      expectedVersion,
      new Date(),
    );
    await removeWithoutThrowing(path);
    throw new ApiError("Uploaded image metadata is invalid", 422);
  }

  const signed = await signPaths([
    ...candidate.note.images.map((image) => image.storagePath),
    candidate.storagePath,
  ]);
  const after = await prisma.$transaction(async (tx) => {
    const note = await lockOwnedNote(tx, userId, noteId);
    assertExpectedVersion(note, expectedVersion);
    assertUntrashed(note);

    const currentCandidate = await tx.noteImage.findFirst({
      where: {
        id: imageId,
        noteId,
        note: { is: { id: noteId, userId, purgeRequestedAt: null } },
      },
      select: internalImageSelect,
    });
    if (!currentCandidate) throw imageNotFound();
    if (currentCandidate.status !== "PENDING") throw invalidImageState();

    const readyImages = await tx.noteImage.findMany({
      where: { noteId, status: "READY" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    await normalizeReadyPositions(tx, noteId, readyImages);

    const promoted = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        WITH db_clock AS (
          SELECT clock_timestamp() AS checked_at
        )
        UPDATE "NoteImage" AS image
        SET
          "status" = ${"READY"}::"NoteImageStatus",
          "position" = ${readyImages.length},
          "uploadExpiresAt" = NULL,
          "updatedAt" = db_clock.checked_at
        FROM db_clock
        WHERE image."id" = ${imageId}
          AND image."noteId" = ${noteId}
          AND image."status" = ${"PENDING"}::"NoteImageStatus"
          AND image."uploadExpiresAt" > db_clock.checked_at
        RETURNING image."id" AS "id"
      `,
    );
    if (promoted.length !== 1) {
      throw new ApiError("Upload intent is expired or unavailable", 409);
    }

    const updated = await tx.note.updateMany({
      where: {
        id: noteId,
        userId,
        version: expectedVersion,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    });
    if (updated.count === 0) {
      return classifyCasFailure(tx, userId, noteId, expectedVersion);
    }

    const result = await tx.note.findFirst({
      where: { id: noteId, userId, purgeRequestedAt: null },
      select: noteResponseSelect,
    });
    if (!result) throw noteNotFound();
    return result;
  });

  return mapNote(after, signed);
}

function assertUniqueOrder(imageIds: readonly string[]): void {
  if (new Set(imageIds).size !== imageIds.length) {
    throw new ApiError("imageIds must not contain duplicates", 400);
  }
}

function validateCompleteImageOrder(
  imageIds: readonly string[],
  suppliedImages: ReadonlyArray<{ id: string; status: NoteImageStatus }>,
  readyImageCount: number,
): void {
  if (suppliedImages.length !== imageIds.length) throw imageNotFound();
  if (suppliedImages.some((image) => image.status !== "READY")) {
    throw invalidImageState();
  }
  if (imageIds.length !== readyImageCount) {
    throw new ApiError("imageIds must contain every ready image", 409);
  }
}

async function findOrderedImagesForValidation(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  noteId: string,
  imageIds: readonly string[],
): Promise<Array<{ id: string; status: NoteImageStatus }>> {
  if (imageIds.length === 0) return [];
  return client.noteImage.findMany({
    where: {
      id: { in: [...imageIds] },
      noteId,
      note: { is: { id: noteId, userId, purgeRequestedAt: null } },
    },
    select: { id: true, status: true },
  });
}

export async function reorderNoteImages(
  userId: string,
  noteId: string,
  input: ImageOrderInput,
  expectedVersion: number,
): Promise<NoteResponse> {
  assertUniqueOrder(input.imageIds);
  const before = await findOwnedNote(userId, noteId);
  assertExpectedVersion(before, expectedVersion);
  assertUntrashed(before);
  const supplied = await findOrderedImagesForValidation(
    prisma,
    userId,
    noteId,
    input.imageIds,
  );
  validateCompleteImageOrder(input.imageIds, supplied, before.images.length);

  const signed = await signNotes([before]);
  const after = await prisma.$transaction(async (tx) => {
    const note = await lockOwnedNote(tx, userId, noteId);
    assertExpectedVersion(note, expectedVersion);
    assertUntrashed(note);
    assertUniqueOrder(input.imageIds);

    const currentSupplied = await findOrderedImagesForValidation(
      tx,
      userId,
      noteId,
      input.imageIds,
    );
    const readyImages = await tx.noteImage.findMany({
      where: { noteId, status: "READY" },
      select: { id: true },
    });
    validateCompleteImageOrder(
      input.imageIds,
      currentSupplied,
      readyImages.length,
    );

    for (const [position, id] of input.imageIds.entries()) {
      const updated = await tx.noteImage.updateMany({
        where: { id, noteId, status: "READY" },
        data: { position },
      });
      if (updated.count === 0) throw invalidImageState();
    }

    const updated = await tx.note.updateMany({
      where: {
        id: noteId,
        userId,
        version: expectedVersion,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    });
    if (updated.count === 0) {
      return classifyCasFailure(tx, userId, noteId, expectedVersion);
    }

    const result = await tx.note.findFirst({
      where: { id: noteId, userId, purgeRequestedAt: null },
      select: noteResponseSelect,
    });
    if (!result) throw noteNotFound();
    return result;
  });

  return mapNote(after, signed);
}

export async function deleteNoteImage(
  userId: string,
  noteId: string,
  imageId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<NoteResponse> {
  const target = await findOwnedImageWithNote(userId, noteId, imageId);
  assertExpectedVersion(target.note, expectedVersion);
  assertUntrashed(target.note);
  if (target.status !== "READY") throw invalidImageState();

  const signed = await signPaths(
    target.note.images
      .filter((image) => image.id !== imageId)
      .map((image) => image.storagePath),
  );
  const after = await prisma.$transaction(async (tx) => {
    const note = await lockOwnedNote(tx, userId, noteId);
    assertExpectedVersion(note, expectedVersion);
    assertUntrashed(note);

    const currentTarget = await tx.noteImage.findFirst({
      where: {
        id: imageId,
        noteId,
        note: { is: { id: noteId, userId, purgeRequestedAt: null } },
      },
      select: internalImageSelect,
    });
    if (!currentTarget) throw imageNotFound();
    if (currentTarget.status !== "READY") throw invalidImageState();

    const readyImages = await tx.noteImage.findMany({
      where: { noteId, status: "READY" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    const hidden = await tx.noteImage.updateMany({
      where: { id: imageId, noteId, status: "READY" },
      data: {
        status: "DELETE_PENDING",
        position: null,
        uploadExpiresAt: null,
        updatedAt: tombstoneDueAt(currentTarget.uploadTokenExpiresAt, now),
      },
    });
    if (hidden.count === 0) throw invalidImageState();

    await normalizeReadyPositions(
      tx,
      noteId,
      readyImages.filter((image) => image.id !== imageId),
    );

    const updated = await tx.note.updateMany({
      where: {
        id: noteId,
        userId,
        version: expectedVersion,
        purgeRequestedAt: null,
        trashedAt: null,
      },
      data: { version: { increment: 1 } },
    });
    if (updated.count === 0) {
      return classifyCasFailure(tx, userId, noteId, expectedVersion);
    }

    const result = await tx.note.findFirst({
      where: { id: noteId, userId, purgeRequestedAt: null },
      select: noteResponseSelect,
    });
    if (!result) throw noteNotFound();
    return result;
  });

  await removeWithoutThrowing(target.storagePath);
  return mapNote(after, signed);
}

export async function permanentlyDeleteNote(
  userId: string,
  noteId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<void> {
  const before = await findOwnedNote(userId, noteId);
  assertExpectedVersion(before, expectedVersion);
  if (before.trashedAt === null) throw invalidNoteState();

  await prisma.$transaction(async (tx) => {
    await lockOwnedNote(tx, userId, noteId);
    const claimed = await tx.note.updateMany({
      where: {
        id: noteId,
        userId,
        version: expectedVersion,
        purgeRequestedAt: null,
        trashedAt: { not: null },
      },
      data: {
        purgeRequestedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (claimed.count === 0) {
      return classifyCasFailure(tx, userId, noteId, expectedVersion);
    }
  });

  try {
    await purgeClaimedNote(noteId, now);
  } catch {
    // The claim is durable; manual permanent deletion is always accepted.
  }
}
