import { useEffect, useState } from "react";
import { Bookmark, TrainFront, Clock, CloudSun, WifiOff } from "lucide-react";
import { useBackground } from "./api/endpoints/background";
import { AttendancePanel } from "./components/AttendancePanel";
import { BottomBar } from "./components/BottomBar";
import { CenterClock } from "./components/CenterClock";
import { Drawer } from "./components/Drawer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LrtWidget } from "./components/LrtWidget";
import { QuickAccess } from "./components/QuickAccess";
import { SearchBar } from "./components/SearchBar";
import { TopNav } from "./components/TopNav";
import { WeatherWidget } from "./components/WeatherWidget";
import { NotesWorkspace } from "./features/notes/NotesWorkspace";
import { useIsOnline } from "./hooks/useIsOnline";
import { usePrefetchDrawers } from "./hooks/usePrefetchDrawers";
import { Badge } from "./components/ui";

const DEFAULT_BACKGROUND =
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80";

export default function Dashboard() {
  const [activeDrawer, setActiveDrawer] = useState<
    "links" | "lrt" | "attendance" | "weather" | "notes" | null
  >(null);
  const { data: backgroundResponse } = useBackground();
  const online = useIsOnline();
  const background = backgroundResponse?.image;
  usePrefetchDrawers();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      switch (e.key.toLowerCase()) {
        case "l":
          e.preventDefault();
          setActiveDrawer((d) =>
            d === "notes" ? d : d === "links" ? null : "links",
          );
          break;
        case "a":
          e.preventDefault();
          setActiveDrawer((d) =>
            d === "notes" ? d : d === "attendance" ? null : "attendance",
          );
          break;
        case "t":
          e.preventDefault();
          setActiveDrawer((d) =>
            d === "notes" ? d : d === "lrt" ? null : "lrt",
          );
          break;
        case "n":
          e.preventDefault();
          setActiveDrawer("notes");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden font-sans text-white bg-slate-950">
      {/* Background Image Container */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-1000 scale-105"
        style={{
          backgroundImage: `url('${background?.url ?? DEFAULT_BACKGROUND}')`,
        }}
      />
      
      {/* Vignette Overlay for Crisp Legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-slate-950/70" />
      <div className="bg-dots absolute inset-0 opacity-40 pointer-events-none" />

      {/* Offline Status Toast */}
      {!online && (
        <div className="absolute top-20 left-0 right-0 z-30 flex justify-center animate-fade-up">
          <Badge variant="warning" size="md" dot>
            <WifiOff className="w-3.5 h-3.5 mr-1" />
            <span>Offline — displaying cached data</span>
          </Badge>
        </div>
      )}

      {/* Top Navigation */}
      <TopNav
        onOpenLinks={() => setActiveDrawer("links")}
        onOpenNotes={() => setActiveDrawer("notes")}
        onOpenLrt={() => setActiveDrawer("lrt")}
        onOpenAttendance={() => setActiveDrawer("attendance")}
        onOpenWeather={() => setActiveDrawer("weather")}
      />

      {/* Hero Section */}
      <main className="relative z-10 h-full flex flex-col items-center justify-center px-6 gap-6 max-w-4xl mx-auto">
        <CenterClock />
        <SearchBar className="w-full" />
      </main>

      {/* Bottom Status Bar */}
      <BottomBar background={background} />

      {/* Links Drawer */}
      <Drawer
        open={activeDrawer === "links"}
        title="Bookmarks & Links"
        icon={<Bookmark className="w-5 h-5" />}
        onClose={() => setActiveDrawer(null)}
      >
        <ErrorBoundary>
          <div className="h-full">
            <QuickAccess />
          </div>
        </ErrorBoundary>
      </Drawer>

      {/* LRT Timetable Drawer */}
      <Drawer
        open={activeDrawer === "lrt"}
        title="Light Rail Transit"
        icon={<TrainFront className="w-5 h-5" />}
        onClose={() => setActiveDrawer(null)}
      >
        <ErrorBoundary>
          <div className="h-full">
            <LrtWidget />
          </div>
        </ErrorBoundary>
      </Drawer>

      {/* Attendance Drawer */}
      <Drawer
        open={activeDrawer === "attendance"}
        title="Attendance & Time"
        icon={<Clock className="w-5 h-5" />}
        onClose={() => setActiveDrawer(null)}
      >
        <ErrorBoundary>
          <div className="h-full">
            <AttendancePanel />
          </div>
        </ErrorBoundary>
      </Drawer>

      {/* Weather Drawer */}
      <Drawer
        open={activeDrawer === "weather"}
        title="Weather Forecast"
        icon={<CloudSun className="w-5 h-5" />}
        onClose={() => setActiveDrawer(null)}
      >
        <ErrorBoundary>
          <WeatherWidget />
        </ErrorBoundary>
      </Drawer>

      {activeDrawer === "notes" && (
        <div className="fixed inset-0 z-40">
          <ErrorBoundary modal>
            <NotesWorkspace onClose={() => setActiveDrawer(null)} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
