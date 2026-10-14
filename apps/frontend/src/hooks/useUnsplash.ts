import { useState, useEffect } from "react";

export interface UnsplashPhoto {
  url: string;
  photographer: string;
  photographerUrl: string;
}

const ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined;
const CACHE_KEY = "dashboard.unsplashPhoto";
const DATE_KEY = "dashboard.unsplashDate";

export function useUnsplash() {
  const [photo, setPhoto] = useState<UnsplashPhoto | null>(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedDate = localStorage.getItem(DATE_KEY);
    const today = new Date().toISOString().slice(0, 10);
    if (cached && cachedDate === today) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState(() => {
    if (photo) return false;
    if (!ACCESS_KEY) return false;
    return true;
  });

  useEffect(() => {
    if (photo) return;
    if (!ACCESS_KEY) return;

    let cancelled = false;

    const fetchPhoto = async () => {
      try {
        const res = await fetch(
          `https://api.unsplash.com/photos/random?query=nature,landscape,scenic&orientation=landscape&w=1920&count=1`,
          { headers: { Authorization: `Client-ID ${ACCESS_KEY}` } }
        );
        if (!res.ok) throw new Error(`Unsplash API error: ${res.status}`);
        const data = await res.json();
        const p = data[0];
        const result: UnsplashPhoto = {
          url: p.urls.raw + "&w=1920&q=80",
          photographer: p.user.name,
          photographerUrl: p.user.links.html,
        };
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));
        localStorage.setItem(DATE_KEY, today);
        if (!cancelled) setPhoto(result);
      } catch {
        // fallback gradient handled by BackgroundImage
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchPhoto();
    return () => { cancelled = true; };
  }, [photo]);

  return { photo, isLoading };
}
