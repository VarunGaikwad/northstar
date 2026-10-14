-- CreateEnum
CREATE TYPE "LrtDayType" AS ENUM ('WEEKDAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "LrtDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "LrtTrainType" AS ENUM ('LOCAL', 'RAPID');

-- CreateEnum
CREATE TYPE "LrtStopType" AS ENUM ('STOP', 'PASS', 'NOSERVICE');

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LrtStation" (
    "id" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "nameRomaji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LrtStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LrtTrip" (
    "id" TEXT NOT NULL,
    "dayType" "LrtDayType" NOT NULL,
    "direction" "LrtDirection" NOT NULL,
    "trainType" "LrtTrainType" NOT NULL,
    "tripIndex" INTEGER NOT NULL,
    "firstDepartMins" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LrtTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LrtStopTime" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "stopSequence" INTEGER NOT NULL,
    "arrivalMins" INTEGER,
    "departureMins" INTEGER,
    "isNextDay" BOOLEAN NOT NULL DEFAULT false,
    "stopType" "LrtStopType" NOT NULL,

    CONSTRAINT "LrtStopTime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "FavLink_userId_idx" ON "FavLink"("userId");

-- CreateIndex
CREATE INDEX "FavLink_folderId_idx" ON "FavLink"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "LrtStation_code_key" ON "LrtStation"("code");

-- CreateIndex
CREATE INDEX "LrtTrip_dayType_direction_idx" ON "LrtTrip"("dayType", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "LrtTrip_dayType_direction_tripIndex_key" ON "LrtTrip"("dayType", "direction", "tripIndex");

-- CreateIndex
CREATE INDEX "LrtStopTime_tripId_idx" ON "LrtStopTime"("tripId");

-- CreateIndex
CREATE INDEX "LrtStopTime_stationId_idx" ON "LrtStopTime"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "LrtStopTime_tripId_stationId_key" ON "LrtStopTime"("tripId", "stationId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavLink" ADD CONSTRAINT "FavLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavLink" ADD CONSTRAINT "FavLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LrtStopTime" ADD CONSTRAINT "LrtStopTime_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "LrtTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LrtStopTime" ADD CONSTRAINT "LrtStopTime_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "LrtStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
