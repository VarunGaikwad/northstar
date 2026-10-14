import { useWeather } from "../api/endpoints/weather";
import { wmoToIcon } from "../utils/weather";

interface WeatherBadgeProps {
  onClick?: () => void;
}

export function WeatherBadge({ onClick }: WeatherBadgeProps) {
  const { data, isLoading, isPending } = useWeather();

  if (isLoading || isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/60">
        <span className="w-4 h-4 rounded-full bg-white/20 animate-pulse" />
        <span>—°</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/60">
        <span>—°</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`${Math.round(data.weather.temperature)} degrees in ${data.location.city}`}
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/10 text-xs font-semibold text-white/90 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
    >
      {wmoToIcon(data.weather.conditionCode, "w-4 h-4")}
      <span>{Math.round(data.weather.temperature)}°</span>
      <span className="hidden text-white/50 font-normal lg:inline">
        {data.location.city}
      </span>
    </button>
  );
}
