import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManualCreateInput } from "./attendance.service";
import { ApiError } from "../../utils/ApiError";
import { dateInTz } from "./attendance.tz";

// validateManualCreateInput is a pure function (no DB). The service module
// transitively imports prisma + env, but this function never touches them.

function assertThrowsApi(fn: () => unknown, status: number, msgRegex: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${String(e)}`);
    // After the instanceof assertion, `e` is narrowed to ApiError.
    assert.equal(e.statusCode, status);
    assert.match(e.message, msgRegex);
    return true;
  });
}

// ── date must not be in the future ──────────────────────────────────
test("rejects a future date with 400", () => {
  assertThrowsApi(
    () =>
      validateManualCreateInput(
        { date: "2099-01-01", checkIn: "09:00", tz: "UTC" },
        new Date("2026-07-26T00:00:00Z"),
      ),
    400,
    /date must not be in the future/,
  );
});

// ── date must not be today (use clock-in instead) ──────────────────
test("rejects today's date (UTC) with 400", () => {
  const now = new Date("2026-07-26T05:00:00Z"); // 05:00 UTC
  const today = dateInTz(now, "UTC"); // "2026-07-26"
  assertThrowsApi(
    () => validateManualCreateInput({ date: today, checkIn: "09:00", tz: "UTC" }, now),
    400,
    /Use the clock-in endpoint for today/,
  );
});

test("rejects today's date in Asia/Tokyo when now is just past midnight JST", () => {
  // 2026-07-26T15:00:00Z == 2026-07-27 00:00 JST → today in Tokyo is 2026-07-27.
  const now = new Date("2026-07-26T15:00:00Z");
  const today = dateInTz(now, "Asia/Tokyo"); // "2026-07-27"
  assertThrowsApi(
    () => validateManualCreateInput({ date: today, checkIn: "09:00", tz: "Asia/Tokyo" }, now),
    400,
    /Use the clock-in endpoint for today/,
  );
});

// ── date in the past is accepted ────────────────────────────────────
test("accepts a past date and converts times to UTC instants (Asia/Tokyo)", () => {
  // 09:00 JST = 00:00 UTC; 18:00 JST = 09:00 UTC, on 2026-01-15.
  const now = new Date("2026-07-26T00:00:00Z");
  const r = validateManualCreateInput(
    { date: "2026-01-15", checkIn: "09:00", checkOut: "18:00", tz: "Asia/Tokyo" },
    now,
  );
  assert.equal(r.date, "2026-01-15");
  assert.equal(r.tz, "Asia/Tokyo");
  assert.equal(r.checkInAt?.toISOString(), "2026-01-15T00:00:00.000Z");
  assert.equal(r.checkOutAt?.toISOString(), "2026-01-15T09:00:00.000Z");
  // workedMinutes would be 540 (computed in toDTO); here just verify ordering.
  assert.ok((r.checkOutAt!.getTime() - r.checkInAt!.getTime()) / 60000 === 540);
});

test("accepts a past date and converts times to UTC (UTC tz)", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const r = validateManualCreateInput(
    { date: "2026-01-15", checkIn: "09:00", checkOut: "18:00", tz: "UTC" },
    now,
  );
  assert.equal(r.checkInAt?.toISOString(), "2026-01-15T09:00:00.000Z");
  assert.equal(r.checkOutAt?.toISOString(), "2026-01-15T18:00:00.000Z");
});

// ── checkOut must be after checkIn (same day) ───────────────────────
test("rejects checkOut before checkIn with 400", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  assertThrowsApi(
    () =>
      validateManualCreateInput(
        { date: "2026-01-15", checkIn: "18:00", checkOut: "09:00", tz: "UTC" },
        now,
      ),
    400,
    /checkOut must be after checkIn/,
  );
});

test("rejects checkOut equal to checkIn with 400", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  assertThrowsApi(
    () =>
      validateManualCreateInput(
        { date: "2026-01-15", checkIn: "12:00", checkOut: "12:00", tz: "UTC" },
        now,
      ),
    400,
    /checkOut must be after checkIn/,
  );
});

// ── single-side records: checkIn only / checkOut only ───────────────
test("accepts checkIn only → checkOutAt is null", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const r = validateManualCreateInput(
    { date: "2026-01-15", checkIn: "09:00", tz: "UTC" },
    now,
  );
  assert.equal(r.checkInAt?.toISOString(), "2026-01-15T09:00:00.000Z");
  assert.equal(r.checkOutAt, null);
});

test("accepts checkOut only → checkInAt is null, no ordering check", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const r = validateManualCreateInput(
    { date: "2026-01-15", checkOut: "09:00", tz: "UTC" },
    now,
  );
  assert.equal(r.checkInAt, null);
  assert.equal(r.checkOutAt?.toISOString(), "2026-01-15T09:00:00.000Z");
});

// ── unknown timezone ────────────────────────────────────────────────
test("rejects an unknown timezone with 400", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  assertThrowsApi(
    () => validateManualCreateInput({ date: "2026-01-15", checkIn: "09:00", tz: "Not/A/Zone" }, now),
    400,
    /Unknown timezone/,
  );
});