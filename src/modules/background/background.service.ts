import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import type { BackgroundImage, BackgroundResponse } from "./background.types";

// ── Daily in-memory cache to protect Unsplash's demo quota ────────────
type CacheEntry = {
  dateKey: string;
  queryKey: string;
  response: BackgroundResponse;
};

let cache: CacheEntry | null = null;

const DEFAULT_BACKGROUND_QUERY = "Beautiful Japan Incredible India";
const RANDOM_PHOTO_COUNT = 30;

function getUtcDateKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10); // yyyy-mm-dd
}

function getUtcDayIndex(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // midnight UTC
  return Math.floor(now.getTime() / 86_400_000); // whole UTC days since epoch
}

function buildImageUrl(rawUrl: string): string {
  const separator = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${separator}w=1920&h=1080&fit=crop&q=80`;
}

function buildQueryKey(query: string | undefined): string {
  return query?.toLowerCase() ?? "default";
}

type UnsplashPhotoItem = {
  id: string;
  alt_description: string | null;
  urls: {
    raw: string;
  };
  links: {
    html: string;
  };
  user: {
    name: string;
    username: string;
    links: {
      html: string;
    };
  };
};

function photoItemToImage(body: UnsplashPhotoItem): BackgroundImage {
  return {
    url: buildImageUrl(body.urls.raw),
    alt: body.alt_description,
    unsplashUrl: body.links.html,
    photographer: {
      name: body.user.name,
      username: body.user.username,
      profileUrl: body.user.links.html
    }
  };
}

// ── Unsplash random photo fetch ──────────────────────────────────────
async function fetchRandomPhoto(
  query: string | undefined
): Promise<BackgroundImage> {
  const params = new URLSearchParams({
    orientation: "landscape",
    count: String(RANDOM_PHOTO_COUNT),
    ...(query ? { query } : {})
  });

  const res = await fetch(`https://api.unsplash.com/photos/random?${params}`, {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1"
    }
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "Unknown error");
    throw new ApiError(`Unsplash API error: ${msg}`, 502);
  }

  const rawBody = (await res.json()) as unknown;

  // Unsplash returns an array when `count` is supplied, a single object when it is not.
  const photos: UnsplashPhotoItem[] = Array.isArray(rawBody)
    ? (rawBody as UnsplashPhotoItem[])
    : [rawBody as UnsplashPhotoItem];
  if (photos.length === 0) {
    throw new ApiError("Unsplash returned no photos", 502);
  }

  // Pick a deterministic candidate based on the UTC day so the wallpaper changes
  // daily even when Unsplash's /photos/random tends to return the same first hit.
  const index = getUtcDayIndex() % photos.length;
  return photoItemToImage(photos[index]);
}

// ── Public service function ──────────────────────────────────────────
export async function getBackground(
  query: string | undefined
): Promise<BackgroundResponse> {
  const effectiveQuery = query?.trim() || DEFAULT_BACKGROUND_QUERY;
  const dateKey = getUtcDateKey();
  const queryKey = buildQueryKey(effectiveQuery);

  if (cache && cache.dateKey === dateKey && cache.queryKey === queryKey) {
    return cache.response;
  }

  const image = await fetchRandomPhoto(effectiveQuery);
  const response: BackgroundResponse = { image };

  cache = { dateKey, queryKey, response };
  return response;
}

// Test helper to reset the in-memory cache between test runs.
export function resetBackgroundCache(): void {
  cache = null;
}
