import type { AttendanceField } from "@prisma/client";

export type AttendanceEditDTO = {
  id: string;
  field: AttendanceField;
  oldValue: string | null; // ISO 8601 (UTC)
  oldValueLocal: string | null; // "HH:MM" in the record's tz
  newValue: string | null;
  newValueLocal: string | null;
  reason: string | null;
  editedAt: string; // ISO 8601 (UTC)
  editedByUserId: string;
};

export type AttendanceDTO = {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (in the record's timezone)
  timezone: string;
  checkInAt: string | null; // ISO 8601 (UTC)
  checkOutAt: string | null;
  checkInLocal: string | null; // "HH:MM" in the record's tz
  checkOutLocal: string | null;
  workedMinutes: number | null; // null until checked out
  createdAt: string;
  updatedAt: string;
  edits: AttendanceEditDTO[];
};

export type AttendanceListResponse = {
  date: string;
  timezone: string;
  attendance: AttendanceDTO | null;
};

export type AttendanceRangeResponse = {
  from: string;
  to: string;
  timezone: string;
  count: number;
  records: AttendanceDTO[];
};

export type AttendanceSummary = {
  daysPresent: number; // records with a check-in
  daysCompleted: number; // records with both check-in AND check-out
  daysClockedOutPending: number; // clocked in but not out yet
  totalWorkedMinutes: number; // sum over completed records
  averageWorkedMinutes: number | null; // per completed day (null if none)
  longestDayMinutes: number | null;
  shortestDayMinutes: number | null;
};

export type AttendanceMonthResponse = {
  month: string; // YYYY-MM
  timezone: string;
  from: string; // YYYY-MM-DD (inclusive)
  to: string; // YYYY-MM-DD (inclusive)
  daysInMonth: number;
  count: number; // records present
  summary: AttendanceSummary;
  records: AttendanceDTO[];
};