import { getAuthState } from "../auth/session";

interface CacheEntry<T> {
  version: number;
  updatedAt: number;
  data: T;
}

const VERSION = 1;

function cacheKey(name: string, userId?: string): string {
  return `northstar.cache.v${VERSION}.${userId ? `${userId}.` : ""}${name}`;
}

export function currentUserId(): string | null {
  return getAuthState().user?.id ?? null;
}

export function readPersistentCache<T>(name: string, userId?: string | null): CacheEntry<T> | null {
  if (userId === null) return null;
  try {
    const raw = localStorage.getItem(cacheKey(name, userId ?? undefined));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (
      entry.version !== VERSION ||
      typeof entry.updatedAt !== "number" ||
      !("data" in entry)
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writePersistentCache<T>(name: string, data: T, userId?: string | null): void {
  if (userId === null) return;
  try {
    localStorage.setItem(
      cacheKey(name, userId ?? undefined),
      JSON.stringify({ version: VERSION, updatedAt: Date.now(), data } satisfies CacheEntry<T>)
    );
  } catch {
    // Keep serving the in-memory query cache when storage is unavailable.
  }
}

export function removePersistentCache(name: string, userId?: string | null): void {
  if (userId === null) return;
  try {
    localStorage.removeItem(cacheKey(name, userId ?? undefined));
  } catch {
    // Storage is unavailable.
  }
}

export function clearUserPersistentCache(userId: string): void {
  removePersistentCache("folders", userId);
  removePersistentCache("favlinks", userId);
}
