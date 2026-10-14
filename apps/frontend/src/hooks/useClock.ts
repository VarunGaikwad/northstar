import { useEffect, useState } from "react";

export interface ClockInfo {
  time: string; // HH:MM:SS
  timeShort: string; // HH:MM
  date: string; // "Monday, January 1"
  greeting: string; // Good Morning / Afternoon / Evening
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function buildClockInfo(now: Date): ClockInfo {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  return {
    time: `${hours}:${minutes}:${pad(now.getSeconds())}`,
    timeShort: `${hours}:${minutes}`,
    date: now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    greeting: greetingFor(now.getHours()),
  };
}

/** Live-updating clock (ticks every second) plus time-of-day greeting. */
export function useClock(): ClockInfo {
  const [info, setInfo] = useState<ClockInfo>(() => buildClockInfo(new Date()));

  useEffect(() => {
    const id = setInterval(() => setInfo(buildClockInfo(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return info;
}
