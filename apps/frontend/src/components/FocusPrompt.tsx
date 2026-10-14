import { useState, useEffect, useRef } from "react";

const FOCUS_KEY = "dashboard.focus";
const FOCUS_DATE_KEY = "dashboard.focusDate";

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FocusPrompt() {
  const [focus, setFocus] = useState<string>(() => {
    const savedDate = localStorage.getItem(FOCUS_DATE_KEY);
    const today = getToday();
    if (savedDate !== today) {
      localStorage.removeItem(FOCUS_KEY);
      localStorage.removeItem(FOCUS_DATE_KEY);
      return "";
    }
    return localStorage.getItem(FOCUS_KEY) ?? "";
  });

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const saveFocus = (value: string) => {
    const trimmed = value.trim();
    localStorage.setItem(FOCUS_KEY, trimmed);
    localStorage.setItem(FOCUS_DATE_KEY, getToday());
    setFocus(trimmed);
    setEditing(false);
  };

  if (!focus || editing) {
    return (
      <div className="mt-6 focus-appear">
        <p className="text-center text-sm font-medium text-white/50 mb-2 tracking-wide uppercase">
          What is your main focus for today?
        </p>
        <input
          ref={inputRef}
          type="text"
          defaultValue={focus}
          placeholder="Write your focus here..."
          onKeyDown={(e) => {
            if (e.key === "Enter") saveFocus(e.currentTarget.value);
            if (e.key === "Escape") { setEditing(false); }
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v) saveFocus(v);
            else setEditing(false);
          }}
          className="w-80 max-w-full bg-transparent border-none text-center text-2xl font-light text-white outline-none placeholder:text-white/30"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-6 focus-appear group cursor-pointer"
    >
      <p className="text-center text-sm font-medium text-white/40 mb-2 tracking-wide uppercase">
        Today's Focus
      </p>
      <p className="text-2xl font-light text-white/90 group-hover:text-white transition-colors">
        {focus}
      </p>
    </button>
  );
}
