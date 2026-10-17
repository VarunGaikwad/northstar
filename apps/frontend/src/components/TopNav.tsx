import { Bookmark, ExternalLink, LogOut, NotebookPen, TrainFront } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { CalendarBadge } from "./CalendarBadge";
import { FocusBadge } from "./FocusBadge";
import { WeatherBadge } from "./WeatherBadge";
import { IconButton } from "./ui";

interface TopNavProps {
  onOpenLinks: () => void;
  onOpenNotes: () => void;
  onOpenLrt: () => void;
  onOpenAttendance: () => void;
  onOpenWeather?: () => void;
}

export function TopNav({
  onOpenLinks,
  onOpenNotes,
  onOpenLrt,
  onOpenAttendance,
  onOpenWeather
}: TopNavProps) {
  const { logout } = useAuth();

  return (
    <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4">
      {/* Left Navigation Pills */}
      <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/40 p-1 sm:gap-2 sm:p-1.5 backdrop-blur-xl shadow-lg">
        <button
          type="button"
          aria-label="Open links"
          title="Links (Alt+L)"
          onClick={onOpenLinks}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95 sm:px-3.5"
        >
          <Bookmark className="w-4 h-4 text-indigo-400" />
          <span className="hidden md:inline">Links</span>
          <kbd className="ml-1 hidden 2xl:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+L</kbd>
        </button>

        <button
          type="button"
          aria-label="Open notes"
          title="Notes (Alt+N)"
          onClick={onOpenNotes}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95 sm:px-3.5"
        >
          <NotebookPen className="h-4 w-4 text-amber-300" />
          <span className="hidden md:inline">Notes</span>
          <kbd className="ml-1 hidden 2xl:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+N</kbd>
        </button>

        <a
          href="https://www.google.com"
          target="_self"
          rel="noopener noreferrer"
          aria-label="Open Google"
          title="Google"
          className="hidden items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95 sm:flex sm:px-3.5"
        >
          <ExternalLink className="w-4 h-4 text-sky-400" />
          <span className="hidden xl:inline">Google</span>
        </a>

        <button
          type="button"
          aria-label="Open light rail transit"
          title="LRT (Alt+T)"
          onClick={onOpenLrt}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95 sm:px-3.5"
        >
          <TrainFront className="w-4 h-4 text-purple-400" />
          <span className="hidden md:inline">LRT</span>
          <kbd className="ml-1 hidden 2xl:inline-block rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/50">Alt+T</kbd>
        </button>
      </div>

      {/* Right Badges & Actions */}
      <div className="flex min-w-0 items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/40 p-1 sm:gap-2 sm:p-1.5 lg:gap-3 backdrop-blur-xl shadow-lg">
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
