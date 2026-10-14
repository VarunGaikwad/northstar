import { CloudSun, Sun as SunIcon, Wind, Droplets, Eye, Gauge, Compass, Sunset, Sunrise } from "lucide-react";
import { useWeather } from "../api/endpoints/weather";
import { wmoToIcon, wmoToText } from "../utils/weather";
import { Badge, Skeleton } from "./ui";

interface WeatherWidgetProps {
  className?: string;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function windDirection(deg: number): string {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(deg / 22.5) % 16];
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
}

function MetricCard({ icon, label, value, unit }: MetricCardProps) {
  return (
    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 flex flex-col justify-between hover:bg-white/[0.1] transition-all">
      <div className="flex items-center gap-2 text-white/50 text-xs font-medium">
        <span className="text-indigo-400">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-bold text-white tracking-tight">
        {value}
        {unit && <span className="text-xs font-normal text-white/60 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export function WeatherWidget({ className }: WeatherWidgetProps) {
  const { data, isLoading, error } = useWeather();

  return (
    <aside className={`h-full overflow-y-auto rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold flex items-center gap-2 text-white">
          <CloudSun className="w-5 h-5 text-amber-300" />
          <span>Weather</span>
        </h2>
        <Badge variant="success" dot size="sm">
          Live
        </Badge>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton variant="rectangular" className="h-28 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton variant="rectangular" className="h-20 rounded-2xl" />
            <Skeleton variant="rectangular" className="h-20 rounded-2xl" />
            <Skeleton variant="rectangular" className="h-20 rounded-2xl" />
            <Skeleton variant="rectangular" className="h-20 rounded-2xl" />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-red-500/15 border border-red-400/30 p-4 text-xs text-red-200">
          {error.message}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Main Temp Hero */}
          <div className="relative rounded-2xl bg-gradient-to-br from-indigo-500/20 via-violet-500/10 to-transparent border border-white/15 p-5 flex items-center justify-between overflow-hidden">
            <div>
              <div className="text-4xl font-black text-white tracking-tight">
                {Math.round(data.weather.temperature)}
                <span className="text-xl font-medium text-indigo-300 align-top">°C</span>
              </div>
              <div className="text-sm font-semibold text-white/90 mt-1">
                {wmoToText(data.weather.conditionCode)}
              </div>
              <div className="text-xs text-white/50 mt-0.5">
                {data.location.city}
                {data.weather.country && data.weather.country !== "—" && `, ${data.weather.country}`}
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-white/10 border border-white/10 backdrop-blur-md shadow-lg">
              {wmoToIcon(data.weather.conditionCode, "w-12 h-12")}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={<Droplets className="w-4 h-4" />} label="Humidity" value={String(data.weather.humidity)} unit="%" />
            <MetricCard icon={<Wind className="w-4 h-4" />} label="Wind Speed" value={data.weather.windSpeed.toFixed(1)} unit="km/h" />
            <MetricCard icon={<Compass className="w-4 h-4" />} label="Direction" value={windDirection(data.weather.windDirection)} />
            <MetricCard icon={<Gauge className="w-4 h-4" />} label="Pressure" value={String(data.weather.pressure)} unit="hPa" />
            <MetricCard icon={<Eye className="w-4 h-4" />} label="Visibility" value={String(data.weather.visibility / 1000)} unit="km" />
            <MetricCard icon={<SunIcon className="w-4 h-4" />} label="Feels Like" value={String(Math.round(data.weather.feelsLike))} unit="°C" />
          </div>

          {/* Sunrise / Sunset */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 flex items-center gap-3">
              <Sunrise className="w-6 h-6 text-amber-400 shrink-0" />
              <div>
                <div className="text-xs text-white/50 font-medium">Sunrise</div>
                <div className="text-sm font-bold text-white">{formatTime(data.weather.sunrise)}</div>
              </div>
            </div>
            <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-3.5 flex items-center gap-3">
              <Sunset className="w-6 h-6 text-orange-400 shrink-0" />
              <div>
                <div className="text-xs text-white/50 font-medium">Sunset</div>
                <div className="text-sm font-bold text-white">{formatTime(data.weather.sunset)}</div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-white/40 text-center font-mono">
            Updated {formatTime(data.weather.timestamp)} · Source: {data.location.source}
          </div>
        </div>
      )}
    </aside>
  );
}
