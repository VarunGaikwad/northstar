import { Image as ImageIcon, Sparkles, Compass } from "lucide-react";
import type { BackgroundImage } from "../api/types";
import { useQuote } from "../api/endpoints/quote";

interface BottomBarProps {
  background?: BackgroundImage;
}

const DEFAULT_QUOTES = [
  "Do not let what you cannot do interfere with what you can do.",
  "Focus on being productive instead of busy.",
  "Small daily improvements over time lead to stunning results.",
  "Make today worth remembering.",
];

export function BottomBar({ background }: BottomBarProps) {
  const { data } = useQuote();
  const quote = data?.quote.text ?? DEFAULT_QUOTES[0];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 text-xs font-medium text-white/80">
      {/* Left Photographer Credit Pill */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/40 border border-white/10 backdrop-blur-xl shadow-lg">
        <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        {background?.photographer ? (
          <a
            href={background.photographer.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition hover:underline truncate max-w-[180px]"
          >
            Photo by {background.photographer.name}
          </a>
        ) : (
          <span className="text-white/60">Northstar Wallpaper</span>
        )}
      </div>

      {/* Center Quote */}
      <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/30 border border-white/10 backdrop-blur-xl max-w-xl text-center shadow-lg animate-fade-up">
        <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        <span className="truncate italic text-white/90">“{quote}”</span>
      </div>

      {/* Right Brand / Status Badge */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/40 border border-white/10 backdrop-blur-xl shadow-lg">
        <Compass className="w-3.5 h-3.5 text-indigo-400" />
        <span className="font-semibold text-white/90">Northstar Dashboard</span>
      </div>
    </div>
  );
}
