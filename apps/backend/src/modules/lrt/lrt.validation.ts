import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const direction = z.enum(["INBOUND", "OUTBOUND"]).optional();
const dayType = z.enum(["WEEKDAY", "HOLIDAY"]).optional();

export const timetableQuerySchema = z
  .object({
    date: isoDate.optional(),
    direction,
    dayType,
  })
  .refine(
    (d) => {
      if (d.date) {
        const [y, m, dd] = d.date.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, dd));
        return (
          dt.getUTCFullYear() === y &&
          dt.getUTCMonth() === m - 1 &&
          dt.getUTCDate() === dd
        );
      }
      return true;
    },
    { message: "date is not a valid calendar date" },
  );

export type TimetableQuery = z.infer<typeof timetableQuerySchema>;

/** from/to may be a station code ("0"), Japanese name, English name, or romaji. */
const stationRef = z.string().trim().min(1, "station is required").max(60);

export const routeSearchQuerySchema = z
  .object({
    date: isoDate.optional(),
    from: stationRef,
    to: stationRef,
    dayType: z.enum(["WEEKDAY", "HOLIDAY"]).optional(),
    includeStops: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v !== "false"), // default true
  })
  .refine(
    (d) => {
      if (d.from === d.to) return false;
      return true;
    },
    { message: "from and to must be different stations", path: ["to"] },
  )
  .refine(
    (d) => {
      if (d.date) {
        const [y, m, dd] = d.date.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, dd));
        return (
          dt.getUTCFullYear() === y &&
          dt.getUTCMonth() === m - 1 &&
          dt.getUTCDate() === dd
        );
      }
      return true;
    },
    { message: "date is not a valid calendar date", path: ["date"] },
  );

export type RouteSearchQuery = z.infer<typeof routeSearchQuerySchema>;