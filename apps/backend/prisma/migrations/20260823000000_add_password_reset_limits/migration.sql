-- CreateTable
CREATE TABLE "PasswordResetLimit" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetLimit_expiresAt_idx" ON "PasswordResetLimit"("expiresAt");

-- Operator cleanup (not run per request): schedule hourly, at most 10 batches per job.
-- Each batch locks/deletes at most 1000 expired rows using the expiresAt index:
-- WITH expired AS (
--   SELECT "id" FROM "PasswordResetLimit"
--   WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
--   ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED
-- )
-- DELETE FROM "PasswordResetLimit" AS limits USING expired
-- WHERE limits."id" = expired."id"
--   AND limits."expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
-- Rollback: remove middleware wiring/deploy the previous app first, then:
-- DROP TABLE "PasswordResetLimit";
-- Dropping the table discards rate-limit windows; do not drop it while middleware is active.
