export function parseHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function formatHMM(minuteOfDay: number): string {
  const m = minuteOfDay % (24 * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function tokyoParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
}

export function tokyoDate(date = new Date()): string {
  const parts = tokyoParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function tokyoMinutes(date = new Date()): number {
  const parts = tokyoParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}
