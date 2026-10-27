import { useEffect, useState } from "react";
import { greetingFor, type GreetingLanguage } from "../utils/greetings";

export interface ClockInfo {
  now: Date;
  time: string; // HH:MM:SS
  timeShort: string; // HH:MM
  date: string; // "Monday, January 1"
  greeting: string; // Localized morning / afternoon / evening greeting
}

function buildClockInfo(now: Date, language: GreetingLanguage): ClockInfo {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  return {
    now,
    time: `${hours}:${minutes}:${pad(now.getSeconds())}`,
    timeShort: `${hours}:${minutes}`,
    date: now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    greeting: greetingFor(now.getHours(), language),
  };
}

/** Live-updating clock (ticks every second) plus time-of-day greeting. */
export function useClock(language: GreetingLanguage = "en"): ClockInfo {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return buildClockInfo(now, language);
}
