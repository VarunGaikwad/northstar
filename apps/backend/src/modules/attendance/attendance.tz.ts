// Timezone helpers — dependency-free, using the built-in Intl API.
// These convert between an IANA timezone's wall-clock components and UTC
// instants, accounting for DST transitions in the tz.

import { ApiError } from "../../utils/ApiError";

/** Validate an IANA timezone name (throws ApiError 400 if invalid). Returns it on success. */
export function normalizeTimezone(tz: string | undefined): string {
  const name = (tz && tz.trim()) || "UTC";
  try {
    // Intl rejects unknown zones with a RangeError.
    new Intl.DateTimeFormat("en-US", { timeZone: name, hour: "numeric" });
  } catch {
    throw new ApiError(`Unknown timezone: "${name}"`, 400);
  }
  return name;
}

/** Format a Date as "YYYY-MM-DD" in the given timezone. */
export function dateInTz(utc: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields "YYYY-MM-DD"
  return fmt.format(utc);
}

/** Format a Date as "HH:MM" (24h, zero-padded) in the given timezone. */
export function timeInTz(utc: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const s = fmt.format(utc);
  // Intl can produce "24:00" at midnight with some locales — normalise.
  return s === "24:00" ? "00:00" : s;
}

/**
 * Convert wall-clock components (already in `tz`) to a UTC Date instant.
 * Handles DST correctly via the Intl API.
 *
 * Algorithm: pretend the wall components are UTC (gives `asUtc`), then look at
 * what a clock in `tz` actually displays at that instant (`asIfUtcTz`). The
 * offset is `asUtc - asIfUtcTz`, so the real instant is `asUtc + offset`.
 */
export function zonedPartsToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(asUtc))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const h = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtcTz = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    h,
    Number(parts.minute),
    Number(parts.second),
    0,
  );
  const offset = asUtc - asIfUtcTz;
  return new Date(asUtc + offset);
}

/** Parse "YYYY-MM-DD" into its numeric components. */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** Parse "H:MM" or "HH:MM" → { hour, minute }. */
export function parseHM(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(":").map(Number);
  return { hour: h, minute: m };
}