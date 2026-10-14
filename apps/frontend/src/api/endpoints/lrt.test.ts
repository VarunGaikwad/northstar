import { afterEach, describe, expect, it, vi } from "vitest";
import { lrtSearchQuery } from "./lrt";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

describe("LRT route query", () => {
  it("uses the explicit Japan service date and excludes unused stop payloads", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { trips: [] } }),
    });
    vi.stubGlobal("fetch", fetch);

    const options = lrtSearchQuery({ from: 0, to: 18, date: "2026-04-02" });
    await options.queryFn?.({} as never);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("from=0&to=18&date=2026-04-02&includeStops=false"),
      expect.any(Object)
    );
    expect(options.staleTime).toBe(86_400_000);
  });
});
