import { useLocalStorage } from "./useLocalStorage";

export interface DailyReminder {
  id: string;
  task: string;
  time: string;
  completedOn?: string;
}

export function localDay(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function isDailyReminder(value: unknown): value is DailyReminder {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.task === "string" && !!item.task.trim()
    && typeof item.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    && (item.completedOn === undefined || typeof item.completedOn === "string");
}

export function dueReminder(reminders: DailyReminder[], now: Date): DailyReminder | undefined {
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return reminders.filter((item) => item.time <= time && item.completedOn !== localDay(now))
    .sort((a, b) => a.time.localeCompare(b.time))[0];
}

export function useDailyReminders() {
  const [stored, setReminders] = useLocalStorage<DailyReminder[]>("greeting.reminders", []);
  const reminders = Array.isArray(stored) ? stored.filter(isDailyReminder) : [];
  const add = (task: string, time: string) => {
    const item = { id: crypto.randomUUID(), task: task.trim(), time };
    if (isDailyReminder(item)) setReminders([...reminders, item]);
  };
  const remove = (id: string) => setReminders(reminders.filter((item) => item.id !== id));
  const complete = (id: string) => setReminders(reminders.map((item) => item.id === id ? { ...item, completedOn: localDay(new Date()) } : item));
  return { reminders, add, remove, complete };
}
