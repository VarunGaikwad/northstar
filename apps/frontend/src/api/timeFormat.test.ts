import { describe, expect, it } from "vitest";
import { tokyoDate, tokyoMinutes } from "./timeFormat";

describe("Tokyo timetable time", () => {
  it("uses Japan's service date around midnight", () => {
    expect(tokyoDate(new Date("2026-04-01T14:59:00.000Z"))).toBe("2026-04-01");
    expect(tokyoDate(new Date("2026-04-01T15:00:00.000Z"))).toBe("2026-04-02");
  });

  it("uses Japan's clock for upcoming departures", () => {
    expect(tokyoMinutes(new Date("2026-04-01T15:30:00.000Z"))).toBe(30);
  });
});
