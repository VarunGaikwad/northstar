# Plan — Quote of the Day endpoint

## Goal
Add a new public, no-auth endpoint `GET /api/quote` that returns one famous
quote per UTC day, sourced from a curated JSON list bundled in the repo
(deterministic daily pick). Mirrors the existing `background` module's
daily-cache pattern.

## Scope (in)
- New module `src/modules/quotes/` (controller / service / routes / types).
- Bundled curated quotes data file `src/modules/quotes/quotes.data.ts`.
- Mount the router in `src/index.ts`.
- Update `ENDPOINTS.md` (new section + route table + TS type).
- Verification via `npx tsc --noEmit` and `eslint src/modules/quotes`.

## Scope (out)
- No DB, no Prisma model, no auth, no external API, no new env vars.
- No query params (single deterministic daily quote). A future `?lang=` /
  `?category=` can be added later.

## Endpoint contract
`GET /api/quote` — Auth: No.

Response `200`:
```json
{
  "success": true,
  "data": {
    "date": "2026-07-26",
    "index": 47,
    "quote": {
      "text": "The only way to do great work is to love what you do.",
      "author": "Steve Jobs"
    }
  }
}
```
- `date`: the UTC `yyyy-mm-dd` that determines the pick (sent so the client
  can render "Quote of the day — Jul 26").
- `index`: position in the bundled list used (helps debugging; optional but
  useful).

## Files to create

### 1. `src/modules/quotes/quotes.types.ts`
```ts
export type Quote = {
  text: string;
  author: string;
  category?: string; // optional: "wisdom" | "life" | "work" etc.
};

export type QuoteResponse = {
  date: string;       // yyyy-mm-dd (UTC)
  index: number;      // 0-based position in the list
  quote: Quote;
};
```

### 2. `src/modules/quotes/quotes.data.ts`
- Export `const QUOTES: Quote[]` — a curated list of ~60–100 famous quotes
  with author. Diverse, well-known, safe (no controversial/religious
  contentious content). Include a `category` on a subset for future use.
- Keep it as a TS const array (not external JSON) so it is bundled and typed.
- If `category` is included, keep it simple: `wisdom | life | work | courage | happiness`.

### 3. `src/modules/quotes/quotes.service.ts`
```ts
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

export async function getQuote(): Promise<QuoteResponse> {
  if (QUOTES.length === 0) {
    throw new ApiError("No quotes available", 500);
  }
  const date = getUtcDateKey();
  const index = pickIndexForDate(date);
  return { date, index, quote: QUOTES[index] };
}
```
- No in-memory cache needed (pure function of date) — but a trivial cache is
  fine too. Kept simple/correct: deterministic, no shared mutable state.

Note (design choice): do NOT reuse the background module's mutable `cache`
pattern, because the quote is a pure function of the date and recomputing is
trivial. This keeps the module stateless and avoids stale-on-restart issues.

### 4. `src/modules/quotes/quotes.controller.ts`
```ts
import type { Request, Response } from "express";
import * as quoteService from "./quotes.service";

export async function getQuote(_req: Request, res: Response): Promise<void> {
  const data = await quoteService.getQuote();
  res.status(200).json({ success: true, data });
}
```
- No query params → no validation file needed (saves a file vs background).

### 5. `src/modules/quotes/quotes.routes.ts`
```ts
import { Router } from "express";
import * as controller from "./quotes.controller";

const router = Router();

// No auth — daily quote from bundled curated list.
router.get("/", controller.getQuote);

export default router;
```

## Files to modify

### 6. `src/index.ts`
- Add import: `import quoteRoutes from "./modules/quotes/quotes.routes";`
- Mount: `app.use("/api/quote", quoteRoutes);` (place near background route,
  line ~49). Singular `/api/quote` since it returns a single quote.

### 7. `ENDPOINTS.md`
- Add "Quote" to Table of Contents (after Background).
- Add new section with table, example response, field notes:
  - `date` is UTC; `index` is the 0-based list position; `quote.text` /
    `quote.author` always present; `quote.category` optional.
  - Same quote returned until UTC midnight; changes daily; deterministic
    across callers and server restarts.
- Add the route to the Summary table and Total count (30 → 31 endpoints).
- Add a `Quote` / `QuoteResponse` TS type block in the TypeScript definitions.

## Data sourcing details
- Curate ~60–100 entries with proper attribution. Use widely-attributed quotes
  (e.g., Steve Jobs, Mahatma Gandhi, Confucius, Marcus Aurelius, Rumi,
  Helen Keller, Eleanor Roosevelt). Avoid misattributed/"fake" quotes; prefer
  short, famous lines. Avoid contentious religious/edgy content.
- Reflect the project's Japan/India connection: include a handful of relevant
  quotes (e.g., Japanese proverbs, Tagore) so the daily rotation has local
  flavor, but keep the majority globally famous.

## Verification steps
1. `npx tsc --noEmit` — must pass.
2. `npx eslint src/modules/quotes` — must pass.
3. Manual smoke (server running): `curl http://localhost:3000/api/quote`
   expect 200 + `{ success: true, data: { date, index, quote } }`.
4. Confirm determinism: calling twice returns the same `index`/`quote`; the
   index matches `floor(UTC midnight epoch / 86400000) mod QUOTES.length`.

## Risks / decisions
- Picking by `Date.parse(yyyy-mm-dd)` epoch handles any valid date string and
  is timezone-stable (always UTC). Verify `QUOTES.length > 0` at runtime
  (defensive).
- Bundled list means quotes are static; refreshed only by editing the data
  file. This is acceptable and matches the "no external dependency" choice.
- No rate limiting / caching needed (pure function), so latency is negligible.

## Out of scope (future)
- `?category=` filter, random vs daily toggle, multi-language, admin-curated
  quotes in DB.