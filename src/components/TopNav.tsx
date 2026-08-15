import { Bookmark, ExternalLink, LogOut, TrainFront } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { CalendarBadge } from "./CalendarBadge";
import { FocusBadge } from "./FocusBadge";
import { WeatherBadge } from "./WeatherBadge";
import { IconButton } from "./ui";

interface TopNavProps {
  onOpenLinks: () => void;
  onOpenLrt: () => void;
  onOpenAttendance: () => void;
  onOpenWeather?: () => void;
}

export function TopNav({
  onOpenLinks,
  onOpenLrt,
  onOpenAttendance,
  onOpenWeather
}: TopNavProps) {
  const { logout } = useAuth();

  return (
    <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4">
      {/* Left Navigation Pills */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900/40 border border-white/10 backdrop-blur-xl shadow-lg">
        <button
          type="button"
          onClick={onOpenLinks}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all cursor-pointer active:scale-95"
        >
          <Bookmark className="w-4 h-4 text-indigo-400" />
          <span>Links</span>
          <kbd className="ml-1 hidden sm:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+L</kbd>
        </button>

        <a
          href="https://www.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all cursor-pointer active:scale-95"
        >
          <ExternalLink className="w-4 h-4 text-sky-400" />
          <span>Google</span>
        </a>

        <button
          type="button"
          onClick={onOpenLrt}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all cursor-pointer active:scale-95"
        >
          <TrainFront className="w-4 h-4 text-purple-400" />
          <span>LRT</span>
          <kbd className="ml-1 hidden sm:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+T</kbd>
        </button>
      </div>

      {/* Right Badges & Actions */}
      <div className="flex items-center gap-3 p-1.5 rounded-2xl bg-slate-900/40 border border-white/10 backdrop-blur-xl shadow-lg">
        <FocusBadge onClick={onOpenAttendance} />
        <CalendarBadge />
        <WeatherBadge onClick={onOpenWeather} />
        <div className="w-px h-5 bg-white/15 mx-0.5" />
        <IconButton
          icon={<LogOut className="w-4 h-4 text-red-300" />}
          label="Log out"
          variant="danger"
          size="sm"
          onClick={() => void logout().catch(() => undefined)}
        />
      </div>
    </nav>
  );
}
