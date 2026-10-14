-- CreateEnum
CREATE TYPE "NoteColor" AS ENUM ('DEFAULT', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'BLUE', 'PURPLE', 'PINK', 'BROWN', 'GRAY');

-- CreateEnum
CREATE TYPE "NoteImageStatus" AS ENUM ('PENDING', 'READY', 'DELETE_PENDING');

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "color" "NoteColor" NOT NULL DEFAULT 'DEFAULT',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "trashedAt" TIMESTAMP(3),
    "purgeRequestedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_version_check" CHECK ("version" > 0),
    CONSTRAINT "Note_isPinned_archivedAt_check" CHECK (NOT "isPinned" OR "archivedAt" IS NULL),
    CONSTRAINT "Note_purgeRequestedAt_trashedAt_check" CHECK ("purgeRequestedAt" IS NULL OR "trashedAt" IS NOT NULL),
    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteImage" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "position" INTEGER,
    "status" "NoteImageStatus" NOT NULL DEFAULT 'PENDING',
    "uploadExpiresAt" TIMESTAMP(3),
    "uploadTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteImage_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
    CONSTRAINT "NoteImage_mimeType_check" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "NoteImage_position_check" CHECK ("position" IS NULL OR "position" >= 0),
    CONSTRAINT "NoteImage_status_fields_check" CHECK (
        ("status" = 'PENDING'
            AND "position" IS NULL
            AND "uploadExpiresAt" IS NOT NULL)
        OR
        ("status" = 'READY'
            AND "position" IS NOT NULL
            AND "uploadExpiresAt" IS NULL)
        OR
        ("status" = 'DELETE_PENDING'
            AND "position" IS NULL
            AND "uploadExpiresAt" IS NULL)
    ),
    CONSTRAINT "NoteImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_userId_trashedAt_archivedAt_isPinned_updatedAt_id_idx" ON "Note"("userId", "trashedAt", "archivedAt", "isPinned", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Note_userId_trashedAt_id_idx" ON "Note"("userId", "trashedAt", "id");

-- CreateIndex
CREATE INDEX "Note_trashedAt_purgeRequestedAt_idx" ON "Note"("trashedAt", "purgeRequestedAt");

-- CreateIndex
CREATE INDEX "Note_purgeRequestedAt_idx" ON "Note"("purgeRequestedAt");

-- CreateIndex
CREATE INDEX "Note_purgeRequestedAt_updatedAt_idx" ON "Note"("purgeRequestedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NoteImage_storagePath_key" ON "NoteImage"("storagePath");

-- CreateIndex
CREATE INDEX "NoteImage_noteId_status_position_idx" ON "NoteImage"("noteId", "status", "position");

-- CreateIndex
CREATE INDEX "NoteImage_status_uploadExpiresAt_idx" ON "NoteImage"("status", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "NoteImage_status_uploadTokenExpiresAt_idx" ON "NoteImage"("status", "uploadTokenExpiresAt");

-- CreateIndex
CREATE INDEX "NoteImage_status_updatedAt_uploadTokenExpiresAt_idx" ON "NoteImage"("status", "updatedAt", "uploadTokenExpiresAt");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteImage" ADD CONSTRAINT "NoteImage_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
