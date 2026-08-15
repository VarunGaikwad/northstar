import { queryOptions, useQuery } from "@tanstack/react-query";
import { apiPublicGet } from "../client";
import { readPersistentCache, writePersistentCache } from "../persistentCache";
import { tokyoDate } from "../timeFormat";
import type { LrtRouteSearchResponse, LrtStationsResponse } from "../types";

const DAY = 86_400_000;

export const lrtStationsQuery = () =>
  queryOptions({
    queryKey: ["lrt", "stations"],
    queryFn: async () => {
      const data = await apiPublicGet<LrtStationsResponse>("/lrt/stations");
      writePersistentCache("lrt-stations", data);
      return data;
    },
    initialData: () => readPersistentCache<LrtStationsResponse>("lrt-stations")?.data,
    initialDataUpdatedAt: () => readPersistentCache<LrtStationsResponse>("lrt-stations")?.updatedAt,
    staleTime: 7 * DAY,
  });

export function lrtSearchQuery({ from, to, date = tokyoDate() }: { from: string | number; to: string | number; date?: string }) {
  const params = new URLSearchParams({
    from: String(from),
    to: String(to),
    date,
    includeStops: "false",
  });
  return queryOptions({
    queryKey: ["lrt", "search", String(from), String(to), date],
    queryFn: async () => {
      const data = await apiPublicGet<LrtRouteSearchResponse>(`/lrt/search?${params.toString()}`);
      writePersistentCache("lrt-route", { from: String(from), to: String(to), date, data });
      return data;
    },
    initialData: () => {
      const cached = readPersistentCache<{ from: string; to: string; date: string; data: LrtRouteSearchResponse }>("lrt-route")?.data;
      return cached?.from === String(from) && cached.to === String(to) && cached.date === date
        ? cached.data
        : undefined;
    },
    initialDataUpdatedAt: () => readPersistentCache("lrt-route")?.updatedAt,
    staleTime: DAY,
  });
}

export function useLrtStations() {
  return useQuery(lrtStationsQuery());
}

export function useLrtSearch({ from, to, date, enabled = true }: { from: string | number; to: string | number; date?: string; enabled?: boolean }) {
  return useQuery({ ...lrtSearchQuery({ from, to, date }), enabled });
}
