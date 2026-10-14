import { ApiError } from "../../utils/ApiError";
import { QUOTES } from "./quotes.data";
import type { QuoteResponse } from "./quotes.types";

function getUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10); // yyyy-mm-dd
}

// Deterministic pick from the UTC date so every caller on the same UTC day
// gets the same quote, without any external call or key.
function pickIndexForDate(yyyymmdd: string): number {
  // Parse the yyyy-mm-dd into a UTC midnight epoch and mod by list length.
  const t = Date.parse(`${yyyymmdd}T00:00:00.000Z`);
  const n = QUOTES.length;
  return ((Math.floor(t / 86_400_000) % n) + n) % n;
}

export function getQuote(): QuoteResponse {
  if (QUOTES.length === 0) {
    throw new ApiError("No quotes available", 500);
  }
  const date = getUtcDateKey();
  const index = pickIndexForDate(date);
  return { date, index, quote: QUOTES[index] };
}
