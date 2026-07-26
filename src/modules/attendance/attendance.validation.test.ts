import { test } from "node:test";
import assert from "node:assert/strict";
import { createManualSchema } from "./attendance.validation";

function ok(input: unknown): boolean {
  return createManualSchema.safeParse(input).success;
}

function issues(input: unknown): string[] {
  const r = createManualSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((e) => e.message);
}

const validBase = {
  date: "2026-01-15",
  checkIn: "09:00",
  checkOut: "18:00",
  tz: "Asia/Tokyo",
  reason: "missed clock-in",
};

// ── Required fields ─────────────────────────────────────────────────
test("rejects when date is missing", () => {
  const { date: _date, ...rest } = validBase;
  assert.equal(ok(rest), false);
  // Missing non-optional strings produce Zod's generic "expected string" error.
  assert.match(issues(rest).join(", "), /expected string, received undefined/i);
});

test("rejects when tz is missing", () => {
  const { tz: _tz, ...rest } = validBase;
  assert.equal(ok(rest), false);
  assert.match(issues(rest).join(", "), /expected string, received undefined/i);
});

test("rejects empty/whitespace tz", () => {
  assert.equal(ok({ ...validBase, tz: "" }), false);
  assert.equal(ok({ ...validBase, tz: "   " }), false);
});

test("rejects unknown timezone value at schema level? (still a string → allowed; service validates)", () => {
  // Schema only checks it's a non-empty string; the service's normalizeTimezone
  // rejects unknown zones. So a syntactically-valid-but-unknown tz passes here.
  assert.equal(ok({ ...validBase, tz: "Not/A/Zone" }), true);
});

// ── date format / validity ──────────────────────────────────────────
test("rejects bad date format (slashes)", () => {
  assert.equal(ok({ ...validBase, date: "2026/01/15" }), false);
  assert.match(issues({ ...validBase, date: "2026/01/15" }).join(", "), /date must be YYYY-MM-DD/);
});

test("rejects impossible calendar date (month 13)", () => {
  assert.equal(ok({ ...validBase, date: "2026-13-01" }), false);
  assert.match(issues({ ...validBase, date: "2026-13-01" }).join(", "), /valid calendar date/);
});

test("rejects impossible calendar date (Feb 30)", () => {
  assert.equal(ok({ ...validBase, date: "2026-02-30" }), false);
  assert.match(issues({ ...validBase, date: "2026-02-30" }).join(", "), /valid calendar date/);
});

// ── HH:MM time format ───────────────────────────────────────────────
test("rejects non-time checkIn", () => {
  assert.equal(ok({ ...validBase, checkIn: "9am" }), false);
});

test("rejects hour 25", () => {
  assert.equal(ok({ ...validBase, checkIn: "25:00" }), false);
});

test("rejects minute 60", () => {
  assert.equal(ok({ ...validBase, checkOut: "09:60" }), false);
});

test("accepts single-digit hour without leading zero (9:00)", () => {
  assert.equal(ok({ ...validBase, checkIn: "9:00" }), true);
});

test("rejects 24:00 (out of schema range)", () => {
  assert.equal(ok({ ...validBase, checkIn: "24:00" }), false);
});

// ── at least one of checkIn / checkOut ──────────────────────────────
test("rejects when neither checkIn nor checkOut is provided", () => {
  const { checkIn: _ci, checkOut: _co, ...rest } = validBase;
  assert.equal(ok(rest), false);
  assert.match(issues(rest).join(", "), /provide at least one of checkIn or checkOut/);
});

test("accepts checkIn only", () => {
  const { checkOut: _co, ...rest } = validBase;
  assert.equal(ok(rest), true);
});

test("accepts checkOut only", () => {
  const { checkIn: _ci, ...rest } = validBase;
  assert.equal(ok(rest), true);
});

// ── reason length ───────────────────────────────────────────────────
test("rejects reason longer than 500 chars", () => {
  assert.equal(ok({ ...validBase, reason: "x".repeat(501) }), false);
});

test("accepts reason at exactly 500 chars", () => {
  assert.equal(ok({ ...validBase, reason: "x".repeat(500) }), true);
});

test("accepts omitted reason", () => {
  const { reason: _r, ...rest } = validBase;
  assert.equal(ok(rest), true);
});

// ── full valid body parses with correct values ─────────────────────
test("parses a fully valid body and preserves values", () => {
  const r = createManualSchema.safeParse(validBase);
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.date, "2026-01-15");
    assert.equal(r.data.checkIn, "09:00");
    assert.equal(r.data.checkOut, "18:00");
    assert.equal(r.data.tz, "Asia/Tokyo");
    assert.equal(r.data.reason, "missed clock-in");
  }
});