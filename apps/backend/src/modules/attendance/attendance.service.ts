import type { Attendance, AttendanceEdit, AttendanceField, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  dateInTz,
  normalizeTimezone,
  parseHM,
  parseIsoDate,
  timeInTz,
  zonedPartsToUtc,
} from "./attendance.tz";
import type {
  AttendanceDTO,
  AttendanceEditDTO,
  AttendanceListResponse,
  AttendanceMonthResponse,
  AttendanceRangeResponse,
  AttendanceSummary,
} from "./attendance.types";

// ── DTO mapping ──────────────────────────────────────────────────────
function toEditDTO(e: AttendanceEdit, tz: string): AttendanceEditDTO {
  return {
    id: e.id,
    field: e.field,
    oldValue: e.oldValue ? e.oldValue.toISOString() : null,
    oldValueLocal: e.oldValue ? timeInTz(e.oldValue, tz) : null,
    newValue: e.newValue ? e.newValue.toISOString() : null,
    newValueLocal: e.newValue ? timeInTz(e.newValue, tz) : null,
    reason: e.reason,
    editedAt: e.editedAt.toISOString(),
    editedByUserId: e.userId,
  };
}

export function toDTO(a: Attendance & { edits?: AttendanceEdit[] }): AttendanceDTO {
  const tz = a.timezone;
  const edits = (a.edits ?? [])
    .slice()
    .sort((x, y) => x.editedAt.getTime() - y.editedAt.getTime())
    .map((e) => toEditDTO(e, tz));

  const workedMinutes =
    a.checkInAt && a.checkOutAt
      ? Math.round((a.checkOutAt.getTime() - a.checkInAt.getTime()) / 60000)
      : null;

  return {
    id: a.id,
    userId: a.userId,
    date: a.date,
    timezone: tz,
    checkInAt: a.checkInAt ? a.checkInAt.toISOString() : null,
    checkOutAt: a.checkOutAt ? a.checkOutAt.toISOString() : null,
    checkInLocal: a.checkInAt ? timeInTz(a.checkInAt, tz) : null,
    checkOutLocal: a.checkOutAt ? timeInTz(a.checkOutAt, tz) : null,
    workedMinutes,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    edits,
  };
}

const withEdits = { edits: { orderBy: { editedAt: "asc" as const } } } satisfies Prisma.AttendanceInclude;

// ── Clock in ─────────────────────────────────────────────────────────
export async function clockIn(userId: string, tzParam?: string): Promise<AttendanceDTO> {
  const tz = normalizeTimezone(tzParam);
  const now = new Date();
  const date = dateInTz(now, tz);

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date } },
    include: withEdits,
  });
  if (existing) {
    throw new ApiError(
      `Already clocked in on ${date} (${tz}) at ${
        existing.checkInAt ? timeInTz(existing.checkInAt, tz) : "—"
      } — use the correct endpoint to fix it`,
      409,
    );
  }

  const created = await prisma.attendance.create({
    data: { userId, date, timezone: tz, checkInAt: now },
    include: withEdits,
  });
  return toDTO(created);
}

// ── Clock out ────────────────────────────────────────────────────────
export async function clockOut(userId: string, tzParam?: string): Promise<AttendanceDTO> {
  const tz = normalizeTimezone(tzParam);
  const now = new Date();
  const date = dateInTz(now, tz);

  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date } },
    include: withEdits,
  });
  if (!record) {
    throw new ApiError(
      `No clock-in found for ${date} (${tz}) — clock in first`,
      404,
    );
  }
  if (record.checkOutAt) {
    throw new ApiError(
      `Already clocked out on ${date} (${tz}) at ${timeInTz(record.checkOutAt, tz)} — use the correct endpoint to fix it`,
      409,
    );
  }
  if (record.checkInAt && now.getTime() < record.checkInAt.getTime()) {
    // Edge guard: should not happen with server clocks, but stay safe.
    throw new ApiError("Clock-out time is before the clock-in time", 400);
  }

  const updated = await prisma.attendance.update({
    where: { id: record.id },
    data: { checkOutAt: now },
    include: withEdits,
  });
  return toDTO(updated);
}

// ── Create a manual record for a past date ────────────────────────────
export type ManualCreateInput = {
  date: string; // YYYY-MM-DD
  checkIn?: string; // HH:MM
  checkOut?: string; // HH:MM
  tz: string; // IANA timezone
  reason?: string;
};

export type ValidatedManual = {
  date: string;
  tz: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

/**
 * Pure validation for manual-record input (no DB access). Assumes the input
 * has already passed the Zod schema (structural shapes). Enforces the
 * timezone-aware rules: date must be a past day (not today, not future), and
 * when both times are present checkOut must be after checkIn. Converts the
 * wall-clock times to UTC instants in `tz`, reusing the same helper as
 * PATCH /api/attendance/:id (`zonedPartsToUtc`).
 *
 * Exported so the rule logic can be unit-tested without a database.
 */
export function validateManualCreateInput(
  input: ManualCreateInput,
  now: Date,
): ValidatedManual {
  const tz = normalizeTimezone(input.tz);
  const today = dateInTz(now, tz);

  if (input.date === today) {
    throw new ApiError(
      "Use the clock-in endpoint for today; manual creation is for past dates",
      400,
    );
  }
  if (input.date > today) {
    throw new ApiError("date must not be in the future", 400);
  }

  const { year, month, day } = parseIsoDate(input.date);

  let checkInAt: Date | null = null;
  let checkOutAt: Date | null = null;
  if (input.checkIn !== undefined) {
    const { hour, minute } = parseHM(input.checkIn);
    checkInAt = zonedPartsToUtc(year, month, day, hour, minute, tz);
  }
  if (input.checkOut !== undefined) {
    const { hour, minute } = parseHM(input.checkOut);
    checkOutAt = zonedPartsToUtc(year, month, day, hour, minute, tz);
  }

  if (checkInAt && checkOutAt && checkOutAt.getTime() <= checkInAt.getTime()) {
    throw new ApiError("checkOut must be after checkIn", 400);
  }

  return { date: input.date, tz, checkInAt, checkOutAt };
}

export async function createManual(
  userId: string,
  input: ManualCreateInput,
): Promise<AttendanceDTO> {
  const { date, tz, checkInAt, checkOutAt } = validateManualCreateInput(input, new Date());

  // One record per (user, date) — duplicates are rejected with 409.
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date } },
    include: withEdits,
  });
  if (existing) {
    throw new ApiError(
      `An attendance record already exists for ${date} (${tz}) — use PATCH /:id to correct it`,
      409,
    );
  }

  // One audit edit per provided field: oldValue null, newValue = the time.
  // Use a single nested create (atomic, one DB round-trip) instead of an
  // interactive $transaction — the @neondatabase/serverless adapter speaks to
  // Postgres over WebSockets, which terminate interactive transactions that
  // hold a connection open across multiple awaited statements.
  const editsCreate: { field: AttendanceField; newValue: Date; reason: string | null }[] = [];
  const reason = input.reason ?? null;
  if (checkInAt) editsCreate.push({ field: "CHECK_IN", newValue: checkInAt, reason });
  if (checkOutAt) editsCreate.push({ field: "CHECK_OUT", newValue: checkOutAt, reason });

  const created = await prisma.attendance.create({
    data: {
      userId,
      date,
      timezone: tz,
      checkInAt,
      checkOutAt,
      edits: {
        create: editsCreate.map((e) => ({
          userId,
          field: e.field,
          oldValue: null,
          newValue: e.newValue,
          reason: e.reason,
        })),
      },
    },
    include: withEdits,
  });
  return toDTO(created);
}

// ── Get my day ───────────────────────────────────────────────────────
export async function getMyDay(
  userId: string,
  dateParam: string | undefined,
  tzParam: string | undefined,
): Promise<AttendanceListResponse> {
  const tz = normalizeTimezone(tzParam);
  const date = dateParam ?? dateInTz(new Date(), tz);

  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date } },
    include: withEdits,
  });
  return {
    date,
    timezone: tz,
    attendance: record ? toDTO(record) : null,
  };
}

// ── Get my range ─────────────────────────────────────────────────────
export async function getMyRange(
  userId: string,
  from: string,
  to: string,
  tzParam: string | undefined,
): Promise<AttendanceRangeResponse> {
  const tz = normalizeTimezone(tzParam);
  const records = await prisma.attendance.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    include: withEdits,
  });
  return {
    from,
    to,
    timezone: tz,
    count: records.length,
    records: records.map(toDTO),
  };
}

// ── Get my month ────────────────────────────────────────────────────
/** Compute the from/to (inclusive) for a YYYY-MM in the given timezone. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  // Last day of month m in year y (in UTC date arithmetic — the record's ts is
  // applied only at read time; bounds are pure calendar strings here).
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

function currentMonthInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  });
  // en-CA yields "YYYY-MM"
  return fmt.format(new Date());
}

export async function getMyMonth(
  userId: string,
  monthParam: string | undefined,
  tzParam: string | undefined,
): Promise<AttendanceMonthResponse> {
  const tz = normalizeTimezone(tzParam);
  const month = monthParam ?? currentMonthInTz(tz);
  const { from, to } = monthBounds(month);
  const daysInMonth = Number(to.slice(-2));

  const records = await prisma.attendance.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    include: withEdits,
  });

  // Build summary from completed / present days.
  let daysPresent = 0;
  let daysCompleted = 0;
  let daysClockedOutPending = 0;
  let totalWorkedMinutes = 0;
  let longest: number | null = null;
  let shortest: number | null = null;

  for (const r of records) {
    daysPresent += 1;
    if (r.checkOutAt && r.checkInAt) {
      daysCompleted += 1;
      const mins = Math.round((r.checkOutAt.getTime() - r.checkInAt.getTime()) / 60000);
      totalWorkedMinutes += mins;
      if (longest === null || mins > longest) longest = mins;
      if (shortest === null || mins < shortest) shortest = mins;
    } else if (r.checkInAt) {
      // Clocked in but not out yet. Records with only a check-out (and no
      // check-in, created manually) are counted as present but neither
      // completed nor pending here.
      daysClockedOutPending += 1;
    }
  }

  const summary: AttendanceSummary = {
    daysPresent,
    daysCompleted,
    daysClockedOutPending,
    totalWorkedMinutes,
    averageWorkedMinutes: daysCompleted > 0 ? Math.round(totalWorkedMinutes / daysCompleted) : null,
    longestDayMinutes: longest,
    shortestDayMinutes: shortest,
  };

  return {
    month,
    timezone: tz,
    from,
    to,
    daysInMonth,
    count: records.length,
    summary,
    records: records.map(toDTO),
  };
}

// ── Correct a record ─────────────────────────────────────────────────
export async function correctAttendance(
  userId: string,
  attendanceId: string,
  input: { checkIn?: string; checkOut?: string; reason?: string },
): Promise<AttendanceDTO> {
  const record = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: withEdits,
  });
  if (!record) {
    throw new ApiError("Attendance record not found", 404);
  }
  if (record.userId !== userId) {
    // Don't leak existence of other users' records.
    throw new ApiError("Attendance record not found", 404);
  }

  const tz = record.timezone;
  const { year, month, day } = parseIsoDate(record.date);

  // Compute new instants for whichever fields are supplied.
  let newCheckIn: Date | null = record.checkInAt;
  let newCheckOut: Date | null = record.checkOutAt;

  if (input.checkIn !== undefined) {
    const { hour, minute } = parseHM(input.checkIn);
    newCheckIn = zonedPartsToUtc(year, month, day, hour, minute, tz);
  }
  if (input.checkOut !== undefined) {
    const { hour, minute } = parseHM(input.checkOut);
    newCheckOut = zonedPartsToUtc(year, month, day, hour, minute, tz);
  }

  // A checkout time may legitimately land on the next UTC day (e.g. late shift
  // in a +tz). Allow checkOut to be before checkIn in *wall* terms only if it
  // falls in the same record day; we instead enforce absolute ordering.
  if (newCheckIn && newCheckOut && newCheckOut.getTime() < newCheckIn.getTime()) {
    throw new ApiError("checkOut must be after checkIn", 400);
  }

  // Build edit rows only for fields that actually changed.
  const edits: { field: AttendanceField; old: Date | null; neu: Date }[] = [];
  if (input.checkIn !== undefined && newCheckIn) {
    const changed = record.checkInAt
      ? record.checkInAt.getTime() !== newCheckIn.getTime()
      : true;
    if (changed) {
      edits.push({ field: "CHECK_IN", old: record.checkInAt, neu: newCheckIn });
    }
  }
  const beforeOut = record.checkOutAt;
  if (input.checkOut !== undefined && newCheckOut) {
    const changed = beforeOut ? beforeOut.getTime() !== newCheckOut.getTime() : true;
    if (changed) {
      edits.push({ field: "CHECK_OUT", old: beforeOut, neu: newCheckOut });
    }
  }

  if (edits.length === 0) {
    // No-op correction (same values). Return as-is.
    return toDTO(record);
  }

  await prisma.$transaction([
    prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkInAt: newCheckIn,
        checkOutAt: newCheckOut,
      },
    }),
    ...edits.map((e) =>
      prisma.attendanceEdit.create({
        data: {
          attendanceId: record.id,
          userId,
          field: e.field,
          oldValue: e.old,
          newValue: e.neu,
          reason: input.reason ?? null,
        },
      }),
    ),
  ]);

  const fresh = await prisma.attendance.findUniqueOrThrow({
    where: { id: record.id },
    include: withEdits,
  });
  return toDTO(fresh);
}

// ── Edit history ─────────────────────────────────────────────────────
export async function getHistory(
  userId: string,
  attendanceId: string,
): Promise<AttendanceEditDTO[]> {
  const record = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });
  if (!record || record.userId !== userId) {
    throw new ApiError("Attendance record not found", 404);
  }
  const edits = await prisma.attendanceEdit.findMany({
    where: { attendanceId },
    orderBy: { editedAt: "asc" },
  });
  return edits.map((e) => toEditDTO(e, record.timezone));
}