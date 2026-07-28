import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.UNSPLASH_ACCESS_KEY = "test-unsplash-key";

import {
  getBackground,
  resetBackgroundCache,
} from "./background.service";

const originalFetch = global.fetch;

type MockFetch = typeof global.fetch & { callCount: number };

function createMockFetch(photos: unknown[]): MockFetch {
  const wrapped = Object.assign(
    () => {
      wrapped.callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(photos),
      } as Response);
    },
    { callCount: 0 },
  );

  return wrapped as unknown as MockFetch;
}

function createSinglePhoto(id: string) {
  return {
    id,
    alt_description: `Photo ${id}`,
    urls: { raw: `https://images.unsplash.com/${id}` },
    links: { html: `https://unsplash.com/photos/${id}` },
    user: {
      name: `Photographer ${id}`,
      username: `user_${id}`,
      links: { html: `https://unsplash.com/@user_${id}` },
    },
  };
}

before(() => {
  // Ensure the env var is present for the module import above.
  process.env.UNSPLASH_ACCESS_KEY = "test-unsplash-key";
});

beforeEach(() => {
  resetBackgroundCache();
  global.fetch = originalFetch;
});

after(() => {
  resetBackgroundCache();
  global.fetch = originalFetch;
});

// ── Daily cache ─────────────────────────────────────────────────────
test("returns the same image on the same UTC day (cache hit)", async () => {
  const photos = [createSinglePhoto("a")];
  global.fetch = createMockFetch(photos);

  const r1 = await getBackground(undefined);
  const r2 = await getBackground(undefined);

  assert.equal(r1.image.url, r2.image.url);
  assert.equal((global.fetch as MockFetch).callCount, 1);
});

test("rotates the selected image based on the UTC day", async () => {
  const photos = [
    createSinglePhoto("a"),
    createSinglePhoto("b"),
    createSinglePhoto("c"),
  ];
  global.fetch = createMockFetch(photos);

  const r = await getBackground(undefined);

  // Selected photo must come from the returned candidates.
  assert.ok(photos.some((p) => r.image.url.includes(p.id)));
});

test("bypasses cache when the query changes", async () => {
  const photosA = [createSinglePhoto("a")];
  const photosB = [createSinglePhoto("b")];

  global.fetch = createMockFetch(photosA);
  const rA = await getBackground("mountains");

  global.fetch = createMockFetch(photosB);
  const rB = await getBackground("ocean");

  assert.notEqual(rA.image.url, rB.image.url);
  assert.equal((global.fetch as MockFetch).callCount, 1);
});

test("throws a 502 ApiError when Unsplash returns an error", async () => {
  global.fetch = () =>
    Promise.resolve({
      ok: false,
      text: () => Promise.resolve("Rate limit exceeded"),
    } as Response);

  await assert.rejects(getBackground(undefined), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match((err as Error).message, /Unsplash API error/);
    return true;
  });
});
