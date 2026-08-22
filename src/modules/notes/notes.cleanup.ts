import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { storageAdapter } from "./notes.storage";
import {
  CLEANUP_RETRY_BACKOFF_MS,
  IMAGE_CLEANUP_BATCH_SIZE,
  NOTE_CLEANUP_BATCH_SIZE,
  STORAGE_REMOVE_BATCH_SIZE,
  UPLOAD_TOKEN_REPLAY_GRACE_MS,
  type NoteCleanupResult,
} from "./notes.types";

type IdRow = { id: string };
type ClaimedUploadRow = {
  id: string;
  noteId: string;
  storagePath: string;
  uploadTokenExpiresAt: Date;
};
type DueImageRow = {
  id: string;
  noteId: string;
  storagePath: string;
  uploadTokenExpiresAt: Date;
};

type PurgeChildRow = {
  id: string;
  storagePath: string;
};

type PurgeBatchClaim =
  | { outcome: "purged" | "deferred"; images: null }
  | { outcome: null; images: PurgeChildRow[] };

export type PurgeClaimedNoteOutcome = "purged" | "deferred" | "failed";

function safeDeleteAt(uploadTokenExpiresAt: Date): Date {
  return new Date(
    uploadTokenExpiresAt.getTime() + UPLOAD_TOKEN_REPLAY_GRACE_MS,
  );
}

async function removePaths(paths: readonly string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)];
  for (
    let offset = 0;
    offset < uniquePaths.length;
    offset += STORAGE_REMOVE_BATCH_SIZE
  ) {
    await storageAdapter.removeObjects(
      uniquePaths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE),
    );
  }
}

async function scheduleNote(
  noteId: string,
  updatedAt: Date,
): Promise<boolean> {
  try {
    const scheduled = await prisma.note.updateMany({
      where: { id: noteId, purgeRequestedAt: { not: null } },
      data: { updatedAt },
    });
    return scheduled.count === 1;
  } catch {
    return false;
  }
}

async function scheduleImages(
  imageIds: readonly string[],
  updatedAt: Date,
): Promise<number> {
  if (imageIds.length === 0) return 0;
  try {
    const scheduled = await prisma.noteImage.updateMany({
      where: {
        id: { in: [...imageIds] },
        status: "DELETE_PENDING",
        note: { is: { purgeRequestedAt: null } },
      },
      data: { updatedAt },
    });
    return scheduled.count;
  } catch {
    return 0;
  }
}

function dueAt(earliestChildDueAt: Date | null, now: Date): Date {
  return earliestChildDueAt !== null && earliestChildDueAt > now
    ? earliestChildDueAt
    : now;
}

async function lockClaimedNote(
  tx: Prisma.TransactionClient,
  noteId: string,
): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Note" WHERE "id" = ${noteId} AND "purgeRequestedAt" IS NOT NULL FOR UPDATE`,
  );
  return locked.length === 1;
}

async function deleteEmptyClaimedNote(
  tx: Prisma.TransactionClient,
  noteId: string,
): Promise<void> {
  const deleted = await tx.note.deleteMany({
    where: {
      id: noteId,
      purgeRequestedAt: { not: null },
      images: { none: {} },
    },
  });
  if (deleted.count !== 1) {
    throw new Error("Claimed note could not be deleted");
  }
}

async function scheduleClaimedNote(
  tx: Prisma.TransactionClient,
  noteId: string,
  updatedAt: Date,
): Promise<void> {
  const scheduled = await tx.note.updateMany({
    where: { id: noteId, purgeRequestedAt: { not: null } },
    data: { updatedAt },
  });
  if (scheduled.count !== 1) {
    throw new Error("Claimed note could not be scheduled");
  }
}

async function getPurgeChildAggregate(
  tx: Prisma.TransactionClient,
  noteId: string,
) {
  return tx.noteImage.aggregate({
    where: { noteId },
    _count: { _all: true },
    _max: { uploadTokenExpiresAt: true },
    _min: { updatedAt: true },
  });
}

async function normalizePurgeChildren(
  tx: Prisma.TransactionClient,
  noteId: string,
  now: Date,
): Promise<void> {
  await tx.noteImage.updateMany({
    where: { noteId, status: { in: ["PENDING", "READY"] } },
    data: {
      status: "DELETE_PENDING",
      position: null,
      uploadExpiresAt: null,
      updatedAt: now,
    },
  });
}

async function claimPurgeBatch(
  noteId: string,
  now: Date,
  retryAt: Date,
): Promise<PurgeBatchClaim> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockClaimedNote(tx, noteId))) {
      return { outcome: "purged", images: null };
    }

    await normalizePurgeChildren(tx, noteId, now);
    const aggregate = await getPurgeChildAggregate(tx, noteId);
    if (aggregate._count._all === 0) {
      await deleteEmptyClaimedNote(tx, noteId);
      return { outcome: "purged", images: null };
    }

    const images = await tx.noteImage.findMany({
      where: {
        noteId,
        status: "DELETE_PENDING",
        updatedAt: { lte: now },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: STORAGE_REMOVE_BATCH_SIZE,
      select: {
        id: true,
        storagePath: true,
      },
    });

    if (images.length === 0) {
      await scheduleClaimedNote(
        tx,
        noteId,
        dueAt(aggregate._min.updatedAt, now),
      );
      return { outcome: "deferred", images: null };
    }

    const leased = await tx.noteImage.updateMany({
      where: {
        id: { in: images.map((image) => image.id) },
        noteId,
        status: "DELETE_PENDING",
        updatedAt: { lte: now },
      },
      data: { updatedAt: retryAt },
    });
    if (leased.count !== images.length) {
      throw new Error("Purge child batch could not be leased");
    }
    await scheduleClaimedNote(tx, noteId, retryAt);
    return { outcome: null, images };
  });
}

async function reconcilePurgeBatch(
  noteId: string,
  images: readonly PurgeChildRow[],
  now: Date,
): Promise<PurgeClaimedNoteOutcome> {
  const imageIds = images.map((image) => image.id);
  return prisma.$transaction(async (tx) => {
    if (!(await lockClaimedNote(tx, noteId))) return "purged";

    await normalizePurgeChildren(tx, noteId, now);
    let aggregate = await getPurgeChildAggregate(tx, noteId);
    if (aggregate._count._all === 0) {
      await deleteEmptyClaimedNote(tx, noteId);
      return "purged";
    }

    const latestTokenExpiry = aggregate._max.uploadTokenExpiresAt;
    if (latestTokenExpiry === null) {
      throw new Error("Purge child aggregate is inconsistent");
    }
    const commonSafeAt = safeDeleteAt(latestTokenExpiry);

    if (commonSafeAt > now) {
      await tx.noteImage.updateMany({
        where: {
          id: { in: imageIds },
          noteId,
          status: "DELETE_PENDING",
        },
        data: { updatedAt: commonSafeAt },
      });
    } else {
      await tx.$queryRaw<IdRow[]>(Prisma.sql`
        DELETE FROM "NoteImage" AS image
        USING "Note" AS note
        WHERE image."id" IN (${Prisma.join(imageIds)})
          AND image."noteId" = ${noteId}
          AND image."noteId" = note."id"
          AND note."purgeRequestedAt" IS NOT NULL
          AND image."status" = ${"DELETE_PENDING"}::"NoteImageStatus"
          AND image."uploadTokenExpiresAt" <= ${new Date(
            now.getTime() - UPLOAD_TOKEN_REPLAY_GRACE_MS,
          )}
        RETURNING image."id" AS "id"
      `);
    }

    aggregate = await getPurgeChildAggregate(tx, noteId);
    if (aggregate._count._all === 0) {
      await deleteEmptyClaimedNote(tx, noteId);
      return "purged";
    }

    await scheduleClaimedNote(
      tx,
      noteId,
      dueAt(aggregate._min.updatedAt, now),
    );
    return "deferred";
  });
}

/**
 * Advances one claimed note by at most one bounded child-path batch. Child rows
 * remain the path inventory until a post-token final removal commits.
 */
export async function purgeClaimedNote(
  noteId: string,
  now = new Date(),
): Promise<PurgeClaimedNoteOutcome> {
  const retryAt = new Date(now.getTime() + CLEANUP_RETRY_BACKOFF_MS);
  let claim: PurgeBatchClaim;
  try {
    claim = await claimPurgeBatch(noteId, now, retryAt);
  } catch {
    await scheduleNote(noteId, retryAt);
    return "failed";
  }
  if (claim.outcome !== null) return claim.outcome;

  try {
    await removePaths(claim.images.map((image) => image.storagePath));
  } catch {
    await scheduleNote(noteId, retryAt);
    return "failed";
  }

  try {
    return await reconcilePurgeBatch(noteId, claim.images, now);
  } catch {
    await scheduleNote(noteId, retryAt);
    return "failed";
  }
}

async function claimExpiredTrash(
  retentionCutoff: Date,
  now: Date,
): Promise<IdRow[]> {
  return prisma.$queryRaw<IdRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "Note"
      WHERE "trashedAt" <= ${retentionCutoff}
        AND "purgeRequestedAt" IS NULL
        AND "updatedAt" <= ${now}
      ORDER BY "trashedAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${NOTE_CLEANUP_BATCH_SIZE}
    )
    UPDATE "Note" AS note
    SET
      "purgeRequestedAt" = ${now},
      "version" = note."version" + 1,
      "updatedAt" = ${now}
    FROM candidates
    WHERE note."id" = candidates."id"
      AND note."purgeRequestedAt" IS NULL
    RETURNING note."id" AS "id"
  `);
}

async function claimDueNotePurges(now: Date, retryAt: Date): Promise<IdRow[]> {
  return prisma.$queryRaw<IdRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "Note"
      WHERE "purgeRequestedAt" IS NOT NULL
        AND "updatedAt" <= ${now}
      ORDER BY "updatedAt" ASC, "purgeRequestedAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${NOTE_CLEANUP_BATCH_SIZE}
    )
    UPDATE "Note" AS note
    SET "updatedAt" = ${retryAt}
    FROM candidates
    WHERE note."id" = candidates."id"
      AND note."purgeRequestedAt" IS NOT NULL
    RETURNING note."id" AS "id"
  `);
}

async function claimExpiredUploads(now: Date): Promise<ClaimedUploadRow[]> {
  return prisma.$queryRaw<ClaimedUploadRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT image."id"
      FROM "NoteImage" AS image
      INNER JOIN "Note" AS note ON note."id" = image."noteId"
      WHERE image."status" = ${"PENDING"}::"NoteImageStatus"
        AND image."uploadExpiresAt" <= ${now}
        AND image."updatedAt" <= ${now}
        AND note."purgeRequestedAt" IS NULL
      ORDER BY image."uploadExpiresAt" ASC, image."id" ASC
      FOR UPDATE OF image, note SKIP LOCKED
      LIMIT ${IMAGE_CLEANUP_BATCH_SIZE}
    )
    UPDATE "NoteImage" AS image
    SET
      "status" = ${"DELETE_PENDING"}::"NoteImageStatus",
      "position" = NULL,
      "uploadExpiresAt" = NULL,
      "updatedAt" = GREATEST(
        ${now},
        image."uploadTokenExpiresAt"
          + (${UPLOAD_TOKEN_REPLAY_GRACE_MS} * INTERVAL '1 millisecond')
      )
    FROM candidates, "Note" AS note
    WHERE image."id" = candidates."id"
      AND note."id" = image."noteId"
      AND note."purgeRequestedAt" IS NULL
      AND image."status" = ${"PENDING"}::"NoteImageStatus"
    RETURNING
      image."id" AS "id",
      image."noteId" AS "noteId",
      image."storagePath" AS "storagePath",
      image."uploadTokenExpiresAt" AS "uploadTokenExpiresAt"
  `);
}

async function claimDueImageDeletes(
  now: Date,
  retryAt: Date,
): Promise<DueImageRow[]> {
  return prisma.$queryRaw<DueImageRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT image."id"
      FROM "NoteImage" AS image
      INNER JOIN "Note" AS note ON note."id" = image."noteId"
      WHERE image."status" = ${"DELETE_PENDING"}::"NoteImageStatus"
        AND image."updatedAt" <= ${now}
        AND image."uploadTokenExpiresAt"
          + (${UPLOAD_TOKEN_REPLAY_GRACE_MS} * INTERVAL '1 millisecond') <= ${now}
        AND note."purgeRequestedAt" IS NULL
      ORDER BY image."updatedAt" ASC, image."id" ASC
      FOR UPDATE OF image, note SKIP LOCKED
      LIMIT ${IMAGE_CLEANUP_BATCH_SIZE}
    )
    UPDATE "NoteImage" AS image
    SET "updatedAt" = ${retryAt}
    FROM candidates, "Note" AS note
    WHERE image."id" = candidates."id"
      AND note."id" = image."noteId"
      AND note."purgeRequestedAt" IS NULL
      AND image."status" = ${"DELETE_PENDING"}::"NoteImageStatus"
    RETURNING
      image."id" AS "id",
      image."noteId" AS "noteId",
      image."storagePath" AS "storagePath",
      image."uploadTokenExpiresAt" AS "uploadTokenExpiresAt"
  `);
}

type ImageCleanupCounts = {
  deleted: number;
  deferred: number;
  failed: number;
};

async function finalizeDueImages(
  rows: readonly DueImageRow[],
  now: Date,
  retryAt: Date,
): Promise<ImageCleanupCounts> {
  const result: ImageCleanupCounts = { deleted: 0, deferred: 0, failed: 0 };
  const processable: DueImageRow[] = [];

  for (const row of rows) {
    const safeAt = safeDeleteAt(row.uploadTokenExpiresAt);
    if (safeAt > now) {
      const scheduled = await scheduleImages([row.id], safeAt);
      if (scheduled === 1) result.deferred += 1;
      else result.failed += 1;
    } else {
      processable.push(row);
    }
  }
  if (processable.length === 0) return result;

  try {
    await removePaths(processable.map((row) => row.storagePath));
  } catch {
    result.failed += processable.length;
    await scheduleImages(
      processable.map((row) => row.id),
      retryAt,
    );
    return result;
  }

  const safeTokenCutoff = new Date(
    now.getTime() - UPLOAD_TOKEN_REPLAY_GRACE_MS,
  );
  try {
    const ids = processable.map((row) => row.id);
    const committed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<IdRow[]>(Prisma.sql`
        SELECT note."id"
        FROM "Note" AS note
        INNER JOIN "NoteImage" AS image ON image."noteId" = note."id"
        WHERE image."id" IN (${Prisma.join(ids)})
          AND note."purgeRequestedAt" IS NULL
        ORDER BY note."id" ASC, image."id" ASC
        FOR UPDATE OF note
      `);

      const deleted = await tx.$queryRaw<IdRow[]>(Prisma.sql`
        DELETE FROM "NoteImage" AS image
        USING "Note" AS note
        WHERE image."id" IN (${Prisma.join(ids)})
          AND image."noteId" = note."id"
          AND note."purgeRequestedAt" IS NULL
          AND image."status" = ${"DELETE_PENDING"}::"NoteImageStatus"
          AND image."uploadTokenExpiresAt" <= ${safeTokenCutoff}
        RETURNING image."id" AS "id"
      `);

      const remaining = await tx.noteImage.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          uploadTokenExpiresAt: true,
          note: { select: { purgeRequestedAt: true } },
        },
      });

      const counts: ImageCleanupCounts = {
        deleted: deleted.length,
        deferred: 0,
        failed: 0,
      };
      for (const image of remaining) {
        if (
          image.note.purgeRequestedAt !== null ||
          image.status !== "DELETE_PENDING"
        ) {
          continue;
        }

        const safeAt = safeDeleteAt(image.uploadTokenExpiresAt);
        const scheduleAt = safeAt > now ? safeAt : retryAt;
        const scheduled = await tx.noteImage.updateMany({
          where: {
            id: image.id,
            status: "DELETE_PENDING",
            note: { is: { purgeRequestedAt: null } },
          },
          data: { updatedAt: scheduleAt },
        });
        if (scheduled.count === 1) {
          if (safeAt > now) counts.deferred += 1;
          else counts.failed += 1;
        }
      }
      return counts;
    });

    result.deleted += committed.deleted;
    result.deferred += committed.deferred;
    result.failed += committed.failed;
  } catch {
    result.failed += processable.length;
    await scheduleImages(
      processable.map((row) => row.id),
      retryAt,
    );
  }
  return result;
}

export async function runNotesCleanup(
  now = new Date(),
): Promise<NoteCleanupResult> {
  const retentionCutoff = new Date(
    now.getTime() - env.NOTE_TRASH_RETENTION_MS,
  );
  const retryAt = new Date(now.getTime() + CLEANUP_RETRY_BACKOFF_MS);
  const result: NoteCleanupResult = {
    claimedNotes: 0,
    purgedNotes: 0,
    deferredNotePurges: 0,
    failedNotePurges: 0,
    claimedUploads: 0,
    deletedImages: 0,
    deferredImageDeletes: 0,
    failedImageDeletes: 0,
  };

  const claimedNotes = await claimExpiredTrash(retentionCutoff, now);
  result.claimedNotes = claimedNotes.length;

  const dueNotePurges = await claimDueNotePurges(now, retryAt);
  for (const note of dueNotePurges) {
    const outcome = await purgeClaimedNote(note.id, now);
    if (outcome === "purged") result.purgedNotes += 1;
    else if (outcome === "deferred") result.deferredNotePurges += 1;
    else result.failedNotePurges += 1;
  }

  const claimedUploads = await claimExpiredUploads(now);
  result.claimedUploads = claimedUploads.length;
  if (claimedUploads.length > 0) {
    try {
      await removePaths(claimedUploads.map((image) => image.storagePath));
      result.deferredImageDeletes += claimedUploads.filter(
        (image) => safeDeleteAt(image.uploadTokenExpiresAt) > now,
      ).length;
    } catch {
      result.failedImageDeletes += claimedUploads.length;
      await scheduleImages(
        claimedUploads.map((image) => image.id),
        retryAt,
      );
    }
  }

  const dueImageDeletes = await claimDueImageDeletes(now, retryAt);
  const imageCounts = await finalizeDueImages(dueImageDeletes, now, retryAt);
  result.deletedImages += imageCounts.deleted;
  result.deferredImageDeletes += imageCounts.deferred;
  result.failedImageDeletes += imageCounts.failed;

  return result;
}
