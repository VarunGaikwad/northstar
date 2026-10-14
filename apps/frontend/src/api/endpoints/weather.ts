import { useQuery } from "@tanstack/react-query";
import { useGeolocation } from "../../hooks/useGeolocation";
import { apiPublicGet } from "../client";
import type { WeatherResponse } from "../types";

export function useWeather(lat?: number, lon?: number) {
  const geo = useGeolocation();
  const effectiveLat = lat ?? geo.lat;
  const effectiveLon = lon ?? geo.lon;
  const hasCoords = effectiveLat !== undefined && effectiveLon !== undefined;

  const params = hasCoords ? `?lat=${effectiveLat}&lon=${effectiveLon}` : "";

  return useQuery({
    queryKey: ["weather", effectiveLat ?? "auto", effectiveLon ?? "auto"],
    queryFn: () => apiPublicGet<WeatherResponse>(`/weather${params}`),
    enabled: (lat !== undefined || lon !== undefined || !geo.isLoading) && hasCoords,
    refetchInterval: 600_000,
  });
}
