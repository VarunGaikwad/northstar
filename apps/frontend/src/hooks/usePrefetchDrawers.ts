import { useEffect } from "react";
import { apiGet } from "../api/client";
import { lrtSearchQuery, lrtStationsQuery } from "../api/endpoints/lrt";
import { queryClient } from "../api/queryClient";
import { tokyoDate } from "../api/timeFormat";
import type { AttendanceDay, AttendanceMonth } from "../api/types";

function monthInputValue(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayParam(d = new Date()): string {
  return d.toISOString().split("T")[0];
}

function savedStation(key: string): number | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

const userTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function usePrefetchDrawers() {
  useEffect(() => {
    const month = monthInputValue();
    const today = todayParam();
    const tz = userTz();
    const from = savedStation("dashboard.lrtFrom");
    const to = savedStation("dashboard.lrtTo");

    void queryClient.prefetchQuery(lrtStationsQuery());
    if (from !== null && to !== null && from !== to) {
      void queryClient.prefetchQuery(lrtSearchQuery({ from, to, date: tokyoDate() }));
    }

    void queryClient.prefetchQuery({
      queryKey: ["attendance", "today", today, tz],
      queryFn: () => apiGet<AttendanceDay>(`/attendance/me?date=${today}&tz=${encodeURIComponent(tz)}`),
    });
    void queryClient.prefetchQuery({
      queryKey: ["attendance", "month", month, tz],
      queryFn: () => apiGet<AttendanceMonth>(`/attendance/me/month?month=${month}&tz=${encodeURIComponent(tz)}`),
    });
  }, []);
}
