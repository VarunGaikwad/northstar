import { Clock } from "lucide-react";
import { useTodayAttendance } from "../api/endpoints/attendance";
import { formatMinutes } from "../utils/overtime";

const DEFAULT_TZ =
  (import.meta.env.VITE_DEFAULT_TZ as string | undefined) ??
  Intl.DateTimeFormat().resolvedOptions().timeZone;

interface FocusBadgeProps {
  onClick?: () => void;
}

export function FocusBadge({ onClick }: FocusBadgeProps) {
  const today = useTodayAttendance(undefined, DEFAULT_TZ);
  const attendance = today.data?.attendance ?? null;

  let label = "Attendance";
  let dot: React.ReactNode = null;
  let active = false;

  if (!today.isLoading && !today.error) {
    if (!attendance) {
      label = "Not clocked in";
      dot = <span className="w-1.5 h-1.5 rounded-full bg-white/40" />;
    } else if (!attendance.checkOutAt) {
      label = `In ${attendance.checkInLocal ?? ""}`.trim();
      dot = (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      );
      active = true;
    } else {
      label = formatMinutes(attendance.workedMinutes);
      dot = <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />;
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (Alt+A)`}
      onClick={onClick}
      className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full border text-xs font-semibold text-white/90 transition-all cursor-pointer shadow-sm active:scale-95 ${
        active
          ? "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/30"
          : "bg-white/[0.08] hover:bg-white/[0.15] border-white/10"
      }`}
    >
      {dot ?? <Clock className="w-3.5 h-3.5 text-emerald-400" />}
      <span className="hidden md:inline tabular-nums">{label}</span>
      <kbd className="hidden 2xl:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+A</kbd>
    </button>
  );
}
