import { useEffect, useState } from "react";

interface GeolocationState {
  lat?: number;
  lon?: number;
  error?: GeolocationPositionError;
  isLoading: boolean;
}

interface IpLocationResponse {
  latitude: number;
  longitude: number;
}

async function fetchIpLocation(): Promise<{ lat: number; lon: number }> {
  const res = await fetch("https://ipapi.co/json/", {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error("IP geolocation failed");
  const data = (await res.json()) as IpLocationResponse;
  if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
    throw new Error("Invalid IP geolocation response");
  }
  return { lat: data.latitude, lon: data.longitude };
}

/** Get the user's current coordinates once. Uses the browser geolocation API
 * first, then falls back to IP-based geolocation if permission is denied or
 * unavailable. */
export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>(() => ({
    isLoading: true,
  }));

  useEffect(() => {
    let cancelled = false;

    const finish = (update: GeolocationState) => {
      if (!cancelled) setState(update);
    };

    const fallbackToIp = (error?: GeolocationPositionError) => {
      fetchIpLocation()
        .then((loc) => finish({ lat: loc.lat, lon: loc.lon, isLoading: false }))
        .catch(() => finish({ error, isLoading: false }));
    };

    if (!navigator.geolocation) {
      fallbackToIp();
      return () => { cancelled = true; };
    }

    // The browser's timeout may not count time spent waiting for permission.
    let browserPending = true;
    const resolveBrowser = (resolve: () => void) => {
      if (cancelled || !browserPending) return;
      browserPending = false;
      window.clearTimeout(deadline);
      resolve();
    };
    const deadline = window.setTimeout(() => resolveBrowser(fallbackToIp), 10_000);

    navigator.geolocation.getCurrentPosition(
      (pos) => resolveBrowser(() => {
        finish({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          isLoading: false,
        });
      }),
      (err) => resolveBrowser(() => fallbackToIp(err)),
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 600_000,
      }
    );

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
    };
  }, []);

  return state;
}
