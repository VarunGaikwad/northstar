# Plan: Unsplash Desktop Background Endpoint

## Goal
Add a public endpoint `GET /api/background` that returns a 1920×1080 Unsplash image suitable for desktop wallpaper, with photographer credit and a curated default query.

## Decisions

| Decision | Resolution |
|----------|------------|
| Path | `/api/background` |
| Auth | Public (matches `/api/weather`, `/api/lrt`) |
| Default image theme | `nature landscape desktop wallpaper` |
| Client theme override | Optional `?query=` query parameter |
| Orientation | `landscape` (16:9) |
| Dimensions | `1920` × `1080`, `fit=crop` on Unsplash raw CDN URL |
| API used | `GET https://api.unsplash.com/photos/random` |
| Rate-limit protection | In-memory daily cache (one image per UTC day) |
| Daily variety | Fetch up to 30 random candidates and pick one deterministically by UTC day index |
| Missing key behavior | Throw `ApiError` 500 if `UNSPLASH_ACCESS_KEY` is not set at startup |
| API failure behavior | Throw `ApiError` 502 with Unsplash error text |

## Affected files

- `src/config/env.ts` — add `UNSPLASH_ACCESS_KEY`
- `src/index.ts` — mount `backgroundRoutes` at `/api/background`
- New module: `src/modules/background/`
  - `background.routes.ts`
  - `background.controller.ts`
  - `background.service.ts`
  - `background.types.ts`
  - `background.validation.ts` (optional `query` schema)

## Implementation details

### 1. Env config

```ts
UNSPLASH_ACCESS_KEY: getEnvVar("UNSPLASH_ACCESS_KEY"),
```

### 2. Service

- Use `fetch` to call Unsplash `/photos/random`.
- Query params:
  - `orientation=landscape`
  - `count=30`
  - `query=${query ?? defaultQuery}`
- Headers:
  - `Authorization: Client-ID ${env.UNSPLASH_ACCESS_KEY}`
  - `Accept-Version: v1`
- Unsplash returns an array of up to 30 candidates.
- Pick one candidate by `getUtcDayIndex() % photos.length` so the wallpaper changes every UTC day even when Unsplash's random endpoint is biased toward the same first result.
- Build final wallpaper URL from `urls.raw`:
  ```
  ${urls.raw}&w=1920&h=1080&fit=crop&q=80
  ```
- Return DTO matching `BackgroundImage` type.

### 3. Daily cache

- In-memory cache keyed by UTC date string (`yyyy-mm-dd`).
- On each request, return cached image if date matches; otherwise fetch and cache.
- Cache is local to process; acceptable for single-server deployment.

### 4. Types

```ts
export type BackgroundImage = {
  id: string;
  url: string;             // 1920x1080 wallpaper URL
  thumbUrl: string;        // small preview
  width: number;
  height: number;
  description: string;
  color: string;
  photographer: {
    name: string;
    username: string;
    profileUrl: string;
  };
  unsplashUrl: string;
  downloadLocation: string;
};
```

### 5. Response format

Consistent with existing controllers:

```json
{
  "success": true,
  "data": { ...BackgroundImage... }
}
```

## Validation plan

1. Start server with `UNSPLASH_ACCESS_KEY` set.
2. `GET /api/background` → returns 200 with 1920×1080 URL and credit.
3. `GET /api/background?query=ocean` → returns ocean-themed wallpaper.
4. Two requests on the same UTC day return identical image data (cache hit).
5. Temporarily remove env key → server fails to start with clear missing-var error.

## Open questions / out of scope

- No Redis/distributed cache.
- No download-tracking endpoint for Unsplash `download_location`.
- No per-user preferences or history.
