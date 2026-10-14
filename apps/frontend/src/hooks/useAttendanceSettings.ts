import { useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";

export interface AttendanceSettings {
  workHoursPerDay: number;
  lunchStart: string; // HH:MM
  lunchEnd: string; // HH:MM
  monthlyOvertimeTargetHours: number;
}

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  workHoursPerDay: 8,
  lunchStart: "11:00",
  lunchEnd: "12:00",
  monthlyOvertimeTargetHours: 20,
};

/**
 * Shared, localStorage-backed attendance settings.
 * The key is stable so all consumers read the same value.
 * Stored values are merged with defaults to survive schema changes.
 */
export function useAttendanceSettings() {
  const [raw, setRaw] = useLocalStorage<AttendanceSettings>(
    "attendance.settings",
    DEFAULT_ATTENDANCE_SETTINGS
  );

  const settings = useMemo(
    () => ({ ...DEFAULT_ATTENDANCE_SETTINGS, ...raw }),
    [raw]
  );

  return [settings, setRaw] as const;
}
