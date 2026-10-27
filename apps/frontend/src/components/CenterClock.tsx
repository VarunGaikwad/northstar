import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings } from "lucide-react";
import { Modal } from "./Modal";
import { ReminderSettings } from "./ReminderSettings";
import { dueReminder, useDailyReminders } from "../hooks/useDailyReminders";
import { useGreetingLanguage } from "../hooks/useGreetingLanguage";
import { GREETING_LANGUAGES, GREETING_LANGUAGE_CODES, isGreetingPreference } from "../utils/greetings";
import { useAuth } from "../auth/useAuth";
import { useClock } from "../hooks/useClock";

export function CenterClock() {
  const { user } = useAuth();
  const { preference, setPreference, language } = useGreetingLanguage();
  const { now, timeShort, greeting } = useClock(language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { reminders, add, remove, complete } = useDailyReminders();
  const reminder = dueReminder(reminders, now);
  const name = user?.firstName ?? user?.lastName ?? user?.email?.split("@")[0] ?? "User";

  return (
    <div className="flex flex-col items-center justify-center text-center text-white select-none animate-fade-up">
      {/* Giant tabular clock display */}
      <div className="text-[7.5rem] sm:text-[9.5rem] md:text-[11.5rem] leading-none font-extrabold tracking-tighter tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white via-white/95 to-white/80 drop-shadow-[0_4px_30px_rgba(0,0,0,0.6)]">
        {timeShort}
      </div>

      {/* Personalized greeting */}
      <h1 aria-live="polite" className="mt-2 sm:mt-4 text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-white/90 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] break-words max-w-full">
        {reminder ? <span>Time to: {reminder.task}, {name}.</span> : <><span lang={language}>{greeting}</span>, <span className="text-indigo-300 font-bold">{name}</span>.</>}
      </h1>
      {reminder && (
        <button type="button" onClick={() => complete(reminder.id)} className="mt-2 min-h-11 rounded-lg bg-indigo-500/30 px-4 text-sm hover:bg-indigo-500/50 focus-visible:outline-2 focus-visible:outline-indigo-300">Mark done</button>
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setSettingsOpen(true)}
        className="mt-2 min-h-11 inline-flex items-center gap-2 rounded-lg px-3 text-sm text-white/75 hover:text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-indigo-300"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
        Greeting & reminders
      </button>
      {settingsOpen && createPortal(
        <Modal open title="Greeting & reminders" onClose={() => setSettingsOpen(false)}>
          <label htmlFor="greeting-language" className="block text-sm font-medium mb-2">Language</label>
          <select
            id="greeting-language"
            value={preference}
            onChange={(event) => {
              if (isGreetingPreference(event.target.value)) setPreference(event.target.value);
            }}
            className="w-full min-h-11 rounded-lg border border-white/20 bg-slate-800 px-3 text-white focus-visible:outline-2 focus-visible:outline-indigo-300"
            aria-describedby="greeting-help"
          >
            <option value="shuffle">Auto shuffle</option>
            {GREETING_LANGUAGE_CODES.map((code) => <option key={code} value={code}>{GREETING_LANGUAGES[code].label}</option>)}
          </select>
          <p id="greeting-help" className="mt-3 text-sm text-white/70">
            Auto shuffle changes language every 30 seconds. Choose a language to keep it fixed.
            Morning, afternoon, and evening greetings follow your local time. Changes are saved automatically in this browser.
          </p>
          <ReminderSettings reminders={reminders} onAdd={add} onRemove={remove} />
        </Modal>,
        document.body,
      )}
    </div>
  );
}
