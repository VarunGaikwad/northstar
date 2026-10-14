/**
 * Seed the Utsunomiya-Haga LRT timetable (parsed from PDFs) into the database.
 *
 * Run:  npx tsx scripts/seed_lrt.ts
 *
 * Idempotent: wipes LrtStopTime / LrtTrip / LrtStation before bulk-inserting.
 * Uses pre-generated IDs + createMany (single multi-row INSERTs) to stay well
 * under Neon's short interactive-transaction timeout.
 */
import "dotenv/config";
import { type LrtDayType, type LrtDirection, type LrtStopType, type LrtTrainType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db/prisma";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, "../prisma/lrdata.json");

type Stop = {
  name: string;
  arr: number | null;
  dep: number | null;
  stopType: "STOP" | "PASS" | "NOSERVICE";
  stationCode: number;
  arrNextDay?: boolean;
  depNextDay?: boolean;
};
type Trip = {
  period: string;
  trainType: "LOCAL" | "RAPID";
  firstDepartMins: number;
  stops: Stop[];
  tripIndex: number;
  dayType: LrtDayType;
  direction: LrtDirection;
};
type DataFile = {
  stations: { code: number; name: string; nameEn: string; nameRomaji: string }[];
  trips: Trip[];
};

const N_STATIONS = 19;

async function main() {
  const raw = readFileSync(DATA_PATH, "utf-8");
  const data = JSON.parse(raw) as DataFile;

  if (data.stations.length !== N_STATIONS) {
    throw new Error(`Expected ${N_STATIONS} stations, got ${data.stations.length}`);
  }

  // Pre-generate IDs so we can use createMany and still wire foreign keys.
  const stationIds = data.stations.map(() => randomUUID());
  const tripIds = data.trips.map(() => randomUUID());

  const stationsInsert = data.stations.map((s, i) => ({
    id: stationIds[i],
    code: s.code,
    name: s.name,
    nameEn: s.nameEn,
    nameRomaji: s.nameRomaji,
  }));

  const tripsInsert = data.trips.map((t, i) => ({
    id: tripIds[i],
    dayType: t.dayType,
    direction: t.direction,
    trainType: t.trainType as LrtTrainType,
    tripIndex: t.tripIndex,
    firstDepartMins: t.firstDepartMins,
  }));

  type StopTimeInsert = {
    id: string;
    tripId: string;
    stationId: string;
    stopSequence: number;
    arrivalMins: number | null;
    departureMins: number | null;
    isNextDay: boolean;
    stopType: LrtStopType;
  };
  const stopTimesInsert: StopTimeInsert[] = [];
  for (let ti = 0; ti < data.trips.length; ti++) {
    const trip = data.trips[ti];
    const tripId = tripIds[ti];
    for (let visit = 0; visit < trip.stops.length; visit++) {
      const s = trip.stops[visit];
      const stopSequence = trip.direction === "INBOUND" ? visit : N_STATIONS - 1 - visit;
      stopTimesInsert.push({
        id: randomUUID(),
        tripId,
        stationId: stationIds[s.stationCode],
        stopSequence,
        arrivalMins: s.arr,
        departureMins: s.dep,
        isNextDay: Boolean(s.arrNextDay || s.depNextDay),
        stopType: s.stopType as LrtStopType,
      });
    }
  }

  console.log(
    `Seeding LRT: ${stationsInsert.length} stations, ${tripsInsert.length} trips, ${stopTimesInsert.length} stop times…`,
  );

  // Wipe (idempotent), then bulk-insert. Not wrapped in a transaction to avoid
  // Neon's interactive-tx timeout; re-running the seed fully resets the data.
  await prisma.lrtStopTime.deleteMany({});
  await prisma.lrtTrip.deleteMany({});
  await prisma.lrtStation.deleteMany({});

  await prisma.lrtStation.createMany({ data: stationsInsert });
  await prisma.lrtTrip.createMany({ data: tripsInsert });
  // Chunk stop-time inserts to keep each statement payload reasonable.
  const CHUNK = 1000;
  for (let i = 0; i < stopTimesInsert.length; i += CHUNK) {
    await prisma.lrtStopTime.createMany({ data: stopTimesInsert.slice(i, i + CHUNK) });
  }

  // Sanity counts
  const [s, t, st] = await Promise.all([
    prisma.lrtStation.count(),
    prisma.lrtTrip.count(),
    prisma.lrtStopTime.count(),
  ]);
  console.log(`Counts -> stations: ${s}, trips: ${t}, stopTimes: ${st}`);
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch(async (e) => {
  console.error("Seed failed:", e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore — already exiting */
  }
  process.exit(1);
});