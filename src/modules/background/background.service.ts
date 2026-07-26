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

const DEFAULT_BACKGROUND_QUERY = "beautiful Japan Incredible India";

function getUtcDateKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10); // yyyy-mm-dd
}

function buildImageUrl(rawUrl: string): string {
  const separator = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${separator}w=1920&h=1080&fit=crop&q=80`;
}

function buildQueryKey(query: string | undefined): string {
  return query?.toLowerCase() ?? "default";
}

// ── Unsplash random photo fetch ──────────────────────────────────────
async function fetchRandomPhoto(query: string | undefined): Promise<BackgroundImage> {
  const params = new URLSearchParams({
    orientation: "landscape",
    ...(query ? { query } : {}),
  });

  const res = await fetch(`https://api.unsplash.com/photos/random?${params}`, {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1",
    },
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "Unknown error");
    throw new ApiError(`Unsplash API error: ${msg}`, 502);
  }

  const body = (await res.json()) as {
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

  return {
    url: buildImageUrl(body.urls.raw),
    alt: body.alt_description,
    unsplashUrl: body.links.html,
    photographer: {
      name: body.user.name,
      username: body.user.username,
      profileUrl: body.user.links.html,
    },
  };
}

// ── Public service function ──────────────────────────────────────────
export async function getBackground(query: string | undefined): Promise<BackgroundResponse> {
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
