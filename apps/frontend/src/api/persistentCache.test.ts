import { afterEach, describe, expect, it } from "vitest";
import { clearUserPersistentCache, readPersistentCache, writePersistentCache } from "./persistentCache";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});

afterEach(() => storage.clear());

describe("persistent cache", () => {
  it("isolates protected data by user", () => {
    writePersistentCache("favlinks", [{ id: "one" }], "user-one");
    writePersistentCache("favlinks", [{ id: "two" }], "user-two");

    expect(readPersistentCache<{ id: string }[]>("favlinks", "user-one")?.data).toEqual([{ id: "one" }]);
    expect(readPersistentCache<{ id: string }[]>("favlinks", "user-two")?.data).toEqual([{ id: "two" }]);
  });

  it("ignores corrupt data and clears protected caches on logout", () => {
    storage.set("northstar.cache.v1.user-one.favlinks", "not-json");
    expect(readPersistentCache("favlinks", "user-one")).toBeNull();

    writePersistentCache("favlinks", [{ id: "one" }], "user-one");
    writePersistentCache("folders", [{ id: "folder" }], "user-one");
    clearUserPersistentCache("user-one");

    expect(readPersistentCache("favlinks", "user-one")).toBeNull();
    expect(readPersistentCache("folders", "user-one")).toBeNull();
  });
});
