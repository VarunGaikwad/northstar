import { useState } from "react";
import type { DailyReminder } from "../hooks/useDailyReminders";

interface Props {
  reminders: DailyReminder[];
  onAdd: (task: string, time: string) => void;
  onRemove: (id: string) => void;
}

const fieldClass = "w-full min-h-11 rounded-lg border border-white/20 bg-slate-800 px-3 text-white focus-visible:outline-2 focus-visible:outline-indigo-300";
const buttonClass = "min-h-11 rounded-lg px-3 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-indigo-300";

export function ReminderSettings({ reminders, onAdd, onRemove }: Props) {
  const [task, setTask] = useState("Lunch break");
  const [time, setTime] = useState("12:30");

  return (
    <section aria-labelledby="reminders-title" className="mt-5 border-t border-white/15 pt-4 max-h-[45vh] overflow-y-auto">
      <h4 id="reminders-title" className="font-semibold">Daily reminders</h4>
      <p className="mt-2 text-sm text-white/70">At the selected local time, a reminder replaces your greeting until you mark it done. Repeats daily while this app is open; no background notifications.</p>
      <ul className="my-3 space-y-2">
        {reminders.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words"><time>{item.time}</time> · {item.task}</span>
            <button type="button" className={`${buttonClass} shrink-0`} aria-label={`Remove ${item.task}`} onClick={() => onRemove(item.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (!task.trim()) return;
        onAdd(task, time);
        setTask("");
      }}>
        <div>
          <label htmlFor="reminder-task" className="block text-sm mb-2">Task</label>
          <input id="reminder-task" className={fieldClass} value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. Lunch break or Stretch" maxLength={100} required />
        </div>
        <div>
          <label htmlFor="reminder-time" className="block text-sm mb-2">Time</label>
          <input id="reminder-time" className={fieldClass} type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
        </div>
        <button type="submit" className={`${buttonClass} bg-indigo-500/30`}>Add reminder</button>
      </form>
    </section>
  );
}
