import { Calendar } from "lucide-react";
import { useClock } from "../hooks/useClock";

export function CalendarBadge() {
  const { date } = useClock();
  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.08] border border-white/10 text-xs font-semibold text-white/90 backdrop-blur-md shadow-sm">
      <Calendar className="w-3.5 h-3.5 text-indigo-400" />
      <span>{date}</span>
    </div>
  );
}
