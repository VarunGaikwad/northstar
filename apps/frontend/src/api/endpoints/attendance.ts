import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../client";
import { queryClient } from "../queryClient";
import type {
  Attendance,
  AttendanceDay,
  AttendanceEditHistory,
  AttendanceMonth,
  AttendanceRange,
} from "../types";

export function useClockIn(tz?: string) {
  return useMutation({
    mutationFn: () => apiPost<Attendance>("/attendance/clock-in", { tz }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
    },
  });
}

export function useClockOut(tz?: string) {
  return useMutation({
    mutationFn: () => apiPost<Attendance>("/attendance/clock-out", { tz }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
    },
  });
}

export function useTodayAttendance(date?: string, tz?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (tz) params.set("tz", tz);
  const qs = params.toString();
  return useQuery({
    queryKey: ["attendance", "today", date ?? "today", tz ?? "UTC"],
    queryFn: () => apiGet<AttendanceDay>(`/attendance/me${qs ? `?${qs}` : ""}`),
  });
}

export function useRangeAttendance(from: string, to: string, tz?: string) {
  const params = new URLSearchParams();
  params.set("from", from);
  params.set("to", to);
  if (tz) params.set("tz", tz);
  return useQuery({
    queryKey: ["attendance", "range", from, to, tz ?? "UTC"],
    queryFn: () => apiGet<AttendanceRange>(`/attendance/me/range?${params.toString()}`),
  });
}

export function useMonthAttendance(month?: string, tz?: string) {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (tz) params.set("tz", tz);
  const qs = params.toString();
  return useQuery({
    queryKey: ["attendance", "month", month ?? "current", tz ?? "UTC"],
    queryFn: () =>
      apiGet<AttendanceMonth>(`/attendance/me/month${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateAttendance() {
  return useMutation({
    mutationFn: (body: {
      date: string;
      tz: string;
      checkIn?: string;
      checkOut?: string;
      reason?: string;
    }) => apiPost<Attendance>("/attendance", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
    },
  });
}

export function useCorrectAttendance() {
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      checkIn?: string;
      checkOut?: string;
      reason?: string;
    }) => apiPatch<Attendance>(`/attendance/${id}`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
      queryClient.invalidateQueries({
        queryKey: ["attendance", "history", variables.id],
      });
    },
  });
}

export function useAttendanceHistory(id: string) {
  return useQuery({
    queryKey: ["attendance", "history", id],
    queryFn: () => apiGet<AttendanceEditHistory>(`/attendance/${id}/history`),
    enabled: !!id,
  });
}
