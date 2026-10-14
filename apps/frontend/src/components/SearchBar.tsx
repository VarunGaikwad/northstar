import { Search, Star, TreeDeciduous, Bookmark, ExternalLink, CornerDownLeft } from "lucide-react";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useFavLinkSearch, type FavLinkSearchResult } from "../hooks/useFavLinkSearch";
import { faviconUrl, fallbackFaviconUrl, gradientFor } from "../utils/gradients";
import { Badge } from "./ui";

interface SearchEngine {
  id: string;
  name: string;
  url: string;
  hint: string;
  icon: React.ReactNode;
}

const GoogleIcon = () => (
  <img src="/google.png" alt="Google" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
);

const DuckIcon = () => (
  <img src="/duckduckgo.png" alt="DuckDuckGo" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
);

const BingIcon = () => (
  <img src="/bing.png" alt="Bing" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
);

const BraveIcon = () => (
  <img src="/brave.png" alt="Brave" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
);

const StartpageIcon = () => (
  <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
);

const EcosiaIcon = () => (
  <TreeDeciduous className="w-5 h-5 text-emerald-400" />
);

const ENGINES: SearchEngine[] = [
  {
    id: "google",
    name: "Google",
    url: "https://www.google.com/search?q=",
    hint: "Search Google or type bookmark name",
    icon: <GoogleIcon />
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    url: "https://duckduckgo.com/?q=",
    hint: "Search DuckDuckGo or type bookmark name",
    icon: <DuckIcon />
  },
  {
    id: "bing",
    name: "Bing",
    url: "https://www.bing.com/search?q=",
    hint: "Search Bing or type bookmark name",
    icon: <BingIcon />
  },
  {
    id: "brave",
    name: "Brave",
    url: "https://search.brave.com/search?q=",
    hint: "Search Brave or type bookmark name",
    icon: <BraveIcon />
  },
  {
    id: "startpage",
    name: "Startpage",
    url: "https://www.startpage.com/sp/search?query=",
    hint: "Search Startpage or type bookmark name",
    icon: <StartpageIcon />
  },
  {
    id: "ecosia",
    name: "Ecosia",
    url: "https://www.ecosia.org/search?q=",
    hint: "Search Ecosia or type bookmark name",
    icon: <EcosiaIcon />
  }
];

interface SearchBarProps {
  autoFocus?: boolean;
  className?: string;
}

function FavlinkSuggestionRow({
  item,
  isSelected,
  onSelect,
  onMouseEnter,
}: {
  item: FavLinkSearchResult;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}) {
  const primaryIcon = faviconUrl(item.url);
  const secondaryIcon = fallbackFaviconUrl(item.url);
  const [iconSrc, setIconSrc] = useState<string | null>(primaryIcon);
  const [iconFailed, setIconFailed] = useState(false);

  const handleIconError = () => {
    if (iconSrc === primaryIcon && secondaryIcon) {
      setIconSrc(secondaryIcon);
    } else {
      setIconFailed(true);
    }
  };

  const showIcon = iconSrc && !iconFailed;
  const initial = (item.title || "?").trim().charAt(0).toUpperCase();

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left cursor-pointer ${
        isSelected
          ? "bg-indigo-500/25 border border-indigo-400/50 shadow-md shadow-indigo-500/10"
          : "hover:bg-white/[0.08] border border-transparent"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradientFor(
            item.title
          )} p-1 flex items-center justify-center shrink-0 shadow-sm`}
        >
          {showIcon ? (
            <img
              src={iconSrc}
              alt=""
              className="w-full h-full object-contain rounded"
              onError={handleIconError}
            />
          ) : (
            <span className="text-xs font-black text-white drop-shadow">
              {initial}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
            <span className={isSelected ? "text-indigo-200 font-bold" : ""}>{item.title}</span>
            <ExternalLink className="w-3 h-3 text-white/40 shrink-0" />
          </div>
          <div className="text-xs text-white/50 truncate font-mono">
            {item.displayHost}
          </div>
        </div>
      </div>

      {item.folderName && (
        <Badge variant="neutral" size="sm" className="shrink-0 ml-2">
          {item.folderName}
        </Badge>
      )}
    </button>
  );
}

export function SearchBar({ autoFocus, className }: SearchBarProps) {
  const [engineId, setEngineId] = useLocalStorage<string>(
    "dashboard.searchEngine",
    "google"
  );
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isSpotlightActive, setIsSpotlightActive] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarWrapperRef = useRef<HTMLDivElement>(null);

  const engineIndex = ENGINES.findIndex((e) => e.id === engineId);
  const engine = ENGINES[engineIndex] ?? ENGINES[0];

  const { matches } = useFavLinkSearch(query);
  const hasMatches = matches.length > 0;

  const shouldSpotlight = isFocused && query.trim().length > 0;



  // Click outside to dismiss dropdown/spotlight
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Smooth FLIP animation when transitioning between Inline & Spotlight mode
  useLayoutEffect(() => {
    if (shouldSpotlight !== isSpotlightActive) {
      if (searchBarWrapperRef.current) {
        const first = searchBarWrapperRef.current.getBoundingClientRect();

        setIsSpotlightActive(shouldSpotlight);

        requestAnimationFrame(() => {
          if (!searchBarWrapperRef.current) return;
          const last = searchBarWrapperRef.current.getBoundingClientRect();

          const deltaX = first.left - last.left;
          const deltaY = first.top - last.top;

          const el = searchBarWrapperRef.current;
          el.style.transition = "none";
          el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

          // Force reflow
          void el.offsetHeight;

          el.style.transition = "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)";
          el.style.transform = "translate(0px, 0px)";
        });
      } else {
        setIsSpotlightActive(shouldSpotlight);
      }
    }
  }, [shouldSpotlight, isSpotlightActive]);

  const toggleEngine = () => {
    const nextIndex = (engineIndex + 1) % ENGINES.length;
    setEngineId(ENGINES[nextIndex].id);
  };

  const openLink = (url: string) => {
    window.open(url, "_blank", "noopener");
    setQuery("");
    setSelectedIndex(-1);
    setIsFocused(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (selectedIndex >= 0 && selectedIndex < matches.length) {
      // Selected a favlink suggestion
      openLink(matches[selectedIndex].url);
    } else {
      // Perform normal search engine search
      window.open(engine.url + encodeURIComponent(q), "_blank", "noopener");
      setQuery("");
      setSelectedIndex(-1);
      setIsFocused(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const totalItems = matches.length + 1; // matches + search engine fallback row

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === "Escape") {
      setIsFocused(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative mx-auto w-full max-w-2xl shrink-0 ${className ?? "mb-6"}`}>
      {/* Backdrop Unfocus Overlay when Spotlight is Active */}
      <div
        className={`fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-40 transition-opacity duration-300 ${
          isSpotlightActive ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsFocused(false)}
      />

      {/* Hero Placeholder Gap (keeps layout stable when wrapper becomes fixed) */}
      {isSpotlightActive && <div className="w-full h-[58px]" />}

      {/* Main Animated Search Bar Container */}
      <div
        ref={searchBarWrapperRef}
        className={
          isSpotlightActive
            ? "fixed top-[18vh] left-1/2 -translate-x-1/2 w-[92vw] max-w-2xl z-50"
            : "relative w-full z-10"
        }
      >
        <form
          onSubmit={handleSubmit}
          className={`flex items-center gap-2 rounded-full border backdrop-blur-2xl pl-2.5 pr-2.5 py-2.5 transition-all duration-300 ${
            isSpotlightActive
              ? "bg-slate-900/90 border-indigo-400/60 shadow-[0_0_40px_rgba(129,140,248,0.35),0_20px_50px_rgba(0,0,0,0.8)]"
              : "bg-white/[0.08] border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)] focus-within:border-indigo-400 focus-within:shadow-[0_0_24px_rgba(129,140,248,0.35),0_12px_40px_rgba(0,0,0,0.4)]"
          }`}
        >
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={toggleEngine}
              aria-label={`Search engine: ${engine.name}`}
              title={`Switch engine (Current: ${engine.name})`}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 border border-white/15 hover:bg-white/20 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer shadow-sm"
            >
              {engine.icon}
            </button>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setIsFocused(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder={`${engine.hint}…`}
            autoFocus={autoFocus}
            className="flex-1 min-w-0 bg-transparent px-3 py-2 text-base text-white placeholder:text-white/60 outline-none font-medium"
          />

          <button
            type="submit"
            aria-label="Search"
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/50 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border border-white/10"
          >
            <Search className="w-4 h-4" />
          </button>
        </form>

        {/* Dropdown Suggestions */}
        {isSpotlightActive && (
          <div className="mt-3 rounded-2xl bg-slate-900/95 border border-white/15 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden max-h-[55vh] overflow-y-auto z-50 animate-fade-up">
            {/* Favlinks Suggestions Section */}
            {hasMatches && (
              <div className="p-2 space-y-1">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <Bookmark className="w-3 h-3 text-indigo-400" />
                  <span>Bookmark Suggestions</span>
                </div>

                {matches.map((item, index) => (
                  <FavlinkSuggestionRow
                    key={item.id}
                    item={item}
                    isSelected={selectedIndex === index}
                    onSelect={() => openLink(item.url)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  />
                ))}
              </div>
            )}

            {/* Divider */}
            {hasMatches && <div className="h-px bg-white/10 my-0.5" />}

            {/* Fallback Search Engine Query Row */}
            <div className="p-2">
              <button
                type="button"
                onClick={() => {
                  window.open(engine.url + encodeURIComponent(query.trim()), "_blank", "noopener");
                  setQuery("");
                  setIsFocused(false);
                }}
                onMouseEnter={() => setSelectedIndex(matches.length)}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left cursor-pointer ${
                  selectedIndex === matches.length
                    ? "bg-indigo-500/25 border border-indigo-400/50 shadow-sm"
                    : "hover:bg-white/[0.08] border border-transparent"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                    {engine.icon}
                  </div>
                  <div className="text-sm font-semibold text-white/90 truncate">
                    Search <strong className="text-white">"{query.trim()}"</strong> on {engine.name}
                  </div>
                </div>
                <CornerDownLeft className="w-4 h-4 text-white/40 shrink-0" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


