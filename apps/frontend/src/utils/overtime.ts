import type { Attendance } from "../api/types";
import type { AttendanceSettings } from "../hooks/useAttendanceSettings";

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/** Minutes of work required before overtime starts (excludes lunch). */
export function dailyThresholdMinutes(settings: AttendanceSettings): number {
  return settings.workHoursPerDay * 60;
}

/**
 * Minutes the lunch break overlaps with the actual presence window.
 * Falls back to 0 if local check-in/out times are unavailable.
 */
export function lunchOverlapMinutes(
  checkInLocal: string | null,
  checkOutLocal: string | null,
  settings: AttendanceSettings
): number {
  if (!checkInLocal || !checkOutLocal) return 0;
  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  if (lunchEnd <= lunchStart) return 0;

  const start = timeToMinutes(checkInLocal);
  const end = timeToMinutes(checkOutLocal);
  if (end <= start) return 0;

  const overlapStart = Math.max(start, lunchStart);
  const overlapEnd = Math.min(end, lunchEnd);
  return Math.max(0, overlapEnd - overlapStart);
}

/** Actual work minutes excluding the overlapping lunch break. */
export function dailyWorkMinutes(
  workedMinutes: number | null,
  checkInLocal: string | null,
  checkOutLocal: string | null,
  settings: AttendanceSettings
): number {
  if (workedMinutes === null) return 0;
  const overlap = lunchOverlapMinutes(checkInLocal, checkOutLocal, settings);
  return Math.max(0, workedMinutes - overlap);
}

export function dailyOvertimeMinutes(
  workedMinutes: number | null,
  checkInLocal: string | null,
  checkOutLocal: string | null,
  settings: AttendanceSettings
): number {
  const work = dailyWorkMinutes(workedMinutes, checkInLocal, checkOutLocal, settings);
  const threshold = dailyThresholdMinutes(settings);
  return Math.max(0, work - threshold);
}

export function monthOvertimeMinutes(
  records: Attendance[],
  settings: AttendanceSettings
): number {
  return records.reduce((sum, record) => {
    if (record.workedMinutes === null || record.checkOutAt === null) return sum;
    return (
      sum +
      dailyOvertimeMinutes(
        record.workedMinutes,
        record.checkInLocal,
        record.checkOutLocal,
        settings
      )
    );
  }, 0);
}
