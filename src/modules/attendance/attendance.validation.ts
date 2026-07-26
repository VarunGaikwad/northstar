import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine(
    (s) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    },
    { message: "date is not a valid calendar date" },
  );

// "HH:MM" 24h, allowing 24:00 → normalised to 00:00 by the service.
const hm = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (00:00–23:59)");

const tz = z.string().trim().max(60).optional();

const tzRequired = z.string().trim().min(1, "tz is required").max(60);

const reason = z.string().trim().max(500).optional();

// Body for clock-in / clock-out: only an optional timezone.
export const clockActionSchema = z.object({ tz });

// Body for creating a manual attendance record for a past date.
// `date` and `tz` are required; at least one of `checkIn` / `checkOut` must
// be supplied. Further (timezone-aware) validation happens in the service.
export const createManualSchema = z
  .object({
    date: isoDate,
    checkIn: hm.optional(),
    checkOut: hm.optional(),
    tz: tzRequired,
    reason,
  })
  .refine((d) => d.checkIn !== undefined || d.checkOut !== undefined, {
    message: "provide at least one of checkIn or checkOut",
    path: [],
  });

// Body for correcting a record's times. At least one of the two must change.
export const correctAttendanceSchema = z
  .object({
    checkIn: hm.optional(),
    checkOut: hm.optional(),
    reason,
  })
  .refine((d) => d.checkIn !== undefined || d.checkOut !== undefined, {
    message: "provide at least one of checkIn or checkOut to correct",
    path: [],
  });

// Query for the "my day" endpoint.
export const myDayQuerySchema = z.object({
  date: isoDate.optional(),
  tz,
});

// Query for the "my range" endpoint.
export const myRangeQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    tz,
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

// Query for the "my month" endpoint — takes a compact month instead of two dates.
const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
  .refine((s) => {
    const m = Number(s.slice(5));
    return m >= 1 && m <= 12;
  }, "month must be between 01 and 12");

export const myMonthQuerySchema = z.object({
  month: monthStr.optional(), // defaults to the current month (in tz)
  tz,
});

export type ClockAction = z.infer<typeof clockActionSchema>;
export type CorrectAttendance = z.infer<typeof correctAttendanceSchema>;
export type CreateManual = z.infer<typeof createManualSchema>;
export type MyDayQuery = z.infer<typeof myDayQuerySchema>;
export type MyRangeQuery = z.infer<typeof myRangeQuerySchema>;
export type MyMonthQuery = z.infer<typeof myMonthQuerySchema>;