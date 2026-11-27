import { useEffect, useState } from "react";

interface GeolocationState {
  lat?: number;
  lon?: number;
  error?: GeolocationPositionError;
  isLoading: boolean;
}

/** Get browser coordinates once; the weather API handles IP fallback. */
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
      finish({ error, isLoading: false });
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
