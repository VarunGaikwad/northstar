import type { LrtDayType, LrtDirection } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import type {
  DirectionTimetable,
  LrtTimetableResponse,
  LrtRouteSearchResponse,
  RouteStopDTO,
  RouteTripDTO,
  StationDTO,
  StopDTO,
  TripDTO,
} from "./lrt.types";

// ── 2026 Japanese public holidays (祝日) ──────────────────────────────
// The timetable is the 2026/4/1 改正, so this covers its valid period.
// Equinox dates are the official 2026 values; review when a new 改正 ships.
const HOLIDAYS_2026 = new Set<string>([
  "2026-01-01", // 元日
  "2026-01-12", // 成人の日
  "2026-02-11", // 建国記念の日
  "2026-02-23", // 天皇誕生日
  "2026-03-20", // 春分の日
  "2026-04-29", // 昭和の日
  "2026-05-03", // 憲法記念日
  "2026-05-04", // みどりの日
  "2026-05-05", // こどもの日
  "2026-05-06", // 振替休日 (5/3 is Sunday)
  "2026-07-20", // 海の日
  "2026-08-11", // 山の日
  "2026-09-21", // 敬老の日
  "2026-09-22", // 国民の休日 (敬老の日と秋分の日にはさまれる日)
  "2026-09-23", // 秋分の日
  "2026-10-12", // スポーツの日
  "2026-11-03", // 文化の日
  "2026-11-23", // 勤労感謝の日
]);

/** Determine the day type for a given ISO date ( YYYY-MM-DD ). */
function resolveDayType(iso: string): LrtDayType {
  if (HOLIDAYS_2026.has(iso)) return "HOLIDAY";
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6 ? "HOLIDAY" : "WEEKDAY";
}

function todayIso(): string {
  // Use UTC for deterministic "today".
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** minutes-from-midnight → "H:MM" (24h). */
function fmtMins(m: number | null): string | null {
  if (m === null) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

export async function listStations(): Promise<StationDTO[]> {
  const rows = await prisma.lrtStation.findMany({ orderBy: { code: "asc" } });
  return rows.map((s) => ({
    code: s.code,
    name: s.name,
    nameEn: s.nameEn,
    nameRomaji: s.nameRomaji,
  }));
}

async function buildDirection(
  dayType: LrtDayType,
  direction: LrtDirection,
): Promise<DirectionTimetable> {
  const trips = await prisma.lrtTrip.findMany({
    where: { dayType, direction },
    orderBy: [{ firstDepartMins: "asc" }, { tripIndex: "asc" }],
    include: {
      stopTimes: {
        orderBy: { stopSequence: "asc" },
        include: { station: true },
      },
    },
  });

  const tripDtos: TripDTO[] = trips.map((t) => {
    const stops: StopDTO[] = t.stopTimes.map((st) => ({
      stopSequence: st.stopSequence,
      stationCode: st.station.code,
      stationName: st.station.name,
      stationNameEn: st.station.nameEn,
      arrival: fmtMins(st.arrivalMins),
      departure: fmtMins(st.departureMins),
      isNextDay: st.isNextDay,
      stopType: st.stopType,
    }));

    // Origin = first STOP in journey order; its departure is the trip's first departure.
    const origin = t.stopTimes.find((st) => st.stopType === "STOP");
    const firstDepartMins = origin?.departureMins ?? origin?.arrivalMins ?? t.firstDepartMins;
    const stopsServed = t.stopTimes.filter((st) => st.stopType === "STOP").length;

    return {
      tripIndex: t.tripIndex,
      dayType: t.dayType,
      direction: t.direction,
      trainType: t.trainType,
      firstDeparture: fmtMins(firstDepartMins) ?? "",
      firstDepartureNextDay: origin?.isNextDay ?? false,
      stopsServed,
      stops,
    };
  });

  return { direction, tripCount: tripDtos.length, trips: tripDtos };
}

/** Resolve a user-supplied station ref (code | Japanese name | English name | romaji). */
async function resolveStation(ref: string): Promise<{ code: number; id: string; name: string; nameEn: string | null; nameRomaji: string | null } | null> {
  const code = Number(ref);
  if (!Number.isNaN(code) && ref.trim() !== "") {
    const byCode = await prisma.lrtStation.findUnique({ where: { code } });
    if (byCode) return byCode;
  }
  // Case-insensitive match against name / nameEn / nameRomaji
  const lower = ref.toLowerCase();
  const all = await prisma.lrtStation.findMany();
  return (
    all.find((s) => s.name === ref) ??
    all.find((s) => (s.nameEn ?? "").toLowerCase() === lower) ??
    all.find((s) => (s.nameRomaji ?? "").toLowerCase() === lower) ??
    null
  );
}

/** Normalize minutes to an absolute timeline so next-day times sort after 23:59. */
function absMins(mins: number, isNextDay: boolean): number {
  return mins + (isNextDay ? 1440 : 0);
}

export type RouteSearchParams = {
  date?: string;
  from: string;
  to: string;
  dayType?: LrtDayType;
  includeStops?: boolean;
};

export async function searchRoute(
  params: RouteSearchParams,
): Promise<LrtRouteSearchResponse> {
  const fromStation = await resolveStation(params.from);
  if (!fromStation) {
    throw new ApiError(`Unknown station: "${params.from}"`, 404);
  }
  const toStation = await resolveStation(params.to);
  if (!toStation) {
    throw new ApiError(`Unknown station: "${params.to}"`, 404);
  }

  const requestedDate = params.date ?? todayIso();
  const today = todayIso();
  const isToday = requestedDate === today;
  const dayType: LrtDayType = params.dayType ?? resolveDayType(requestedDate);

  // Direction: lower code → higher code is INBOUND (0..18 toward Utsunomiya).
  const direction: LrtDirection =
    fromStation.code < toStation.code ? "INBOUND" : "OUTBOUND";

  const trips = await prisma.lrtTrip.findMany({
    where: { dayType, direction },
    orderBy: [{ firstDepartMins: "asc" }, { tripIndex: "asc" }],
    include: {
      stopTimes: {
        orderBy: { stopSequence: "asc" },
        include: { station: true },
      },
    },
  });

  const resultTrips: RouteTripDTO[] = [];

  for (const t of trips) {
    const fromStop = t.stopTimes.find(
      (st) => st.station.code === fromStation.code && st.stopType === "STOP",
    );
    const toStop = t.stopTimes.find(
      (st) => st.station.code === toStation.code && st.stopType === "STOP",
    );
    // The train must STOP at both endpoints on this trip.
    if (!fromStop || !toStop) continue;

    // Passenger boards at the from-station departure, alights at the to-station arrival.
    const depMins = fromStop.departureMins ?? fromStop.arrivalMins;
    const arrMins = toStop.arrivalMins ?? toStop.departureMins;
    if (depMins === null || arrMins === null) continue;

    const depAbs = absMins(depMins, fromStop.isNextDay);
    const arrAbs = absMins(arrMins, toStop.isNextDay);
    const durationMins = arrAbs - depAbs;

    // Count STOP stations served *between* (exclusive) from and to along the journey.
    const stopsBetween = t.stopTimes.filter((st) => {
      if (st.stopType !== "STOP") return false;
      const seq = st.stopSequence;
      const fromSeq = fromStop.stopSequence;
      const toSeq = toStop.stopSequence;
      return direction === "INBOUND"
        ? seq > fromSeq && seq < toSeq
        : seq < fromSeq && seq > toSeq;
    }).length;

    const stopDtos: StopDTO[] = t.stopTimes.map((st) => ({
      stopSequence: st.stopSequence,
      stationCode: st.station.code,
      stationName: st.station.name,
      stationNameEn: st.station.nameEn,
      arrival: fmtMins(st.arrivalMins),
      departure: fmtMins(st.departureMins),
      isNextDay: st.isNextDay,
      stopType: st.stopType,
    }));

    const fromDto: RouteStopDTO = {
      stationCode: fromStation.code,
      stationName: fromStation.name,
      stationNameEn: fromStation.nameEn,
      time: fmtMins(depMins),
      isNextDay: fromStop.isNextDay,
    };
    const toDto: RouteStopDTO = {
      stationCode: toStation.code,
      stationName: toStation.name,
      stationNameEn: toStation.nameEn,
      time: fmtMins(arrMins),
      isNextDay: toStop.isNextDay,
    };

    resultTrips.push({
      tripIndex: t.tripIndex,
      trainType: t.trainType,
      direction,
      from: fromDto,
      to: toDto,
      durationMins,
      stopsBetween,
      stops: params.includeStops === false ? [] : stopDtos,
    });
  }

  // Sort by absolute departure at the from-station; next-day trips sort last.
  resultTrips.sort((a, b) => {
    const am = absMins(parseHMMAux(a.from.time), a.from.isNextDay);
    const bm = absMins(parseHMMAux(b.from.time), b.from.isNextDay);
    return am - bm;
  });

  return {
    date: requestedDate,
    dayType,
    isToday,
    from: { code: fromStation.code, name: fromStation.name, nameEn: fromStation.nameEn, nameRomaji: fromStation.nameRomaji },
    to: { code: toStation.code, name: toStation.name, nameEn: toStation.nameEn, nameRomaji: toStation.nameRomaji },
    direction,
    tripCount: resultTrips.length,
    trips: resultTrips,
  };
}

/** "H:MM" → minutes-from-midnight (for sorting). */
function parseHMMAux(h: string | null): number {
  if (!h) return 0;
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}

export type TimetableParams = {
  date?: string;
  direction?: LrtDirection;
  dayType?: LrtDayType;
};

export async function getTimetable(
  params: TimetableParams,
): Promise<LrtTimetableResponse> {
  const requestedDate = params.date ?? todayIso();
  const today = todayIso();
  const isToday = requestedDate === today;

  const dayType: LrtDayType = params.dayType ?? resolveDayType(requestedDate);

  const directions: LrtDirection[] = params.direction
    ? [params.direction]
    : ["INBOUND", "OUTBOUND"];

  const built = await Promise.all(directions.map((d) => buildDirection(dayType, d)));

  if (built.every((d) => d.tripCount === 0)) {
    // Database may not be seeded.
    throw new ApiError(
      "No LRT timetable data found. Run the seed:lrt script to load the timetable.",
      404,
    );
  }

  return {
    date: requestedDate,
    dayType,
    isToday,
    directions: built,
  };
}