-- AlterTable
-- Manual attendance creation can record a record with only a check-out
-- (and no check-in), so drop the NOT NULL constraint on "checkInAt".
ALTER TABLE "Attendance" ALTER COLUMN "checkInAt" DROP NOT NULL;