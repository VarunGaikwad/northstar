import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";

export function wmoToIcon(code: number, className = "w-5 h-5") {
  if (code === 0) return <Sun className={`${className} text-yellow-300`} />;
  if ([1, 2].includes(code)) return <CloudSun className={`${className} text-yellow-200`} />;
  if (code === 3) return <Cloud className={`${className} text-slate-300`} />;
  if ([45, 48].includes(code)) return <CloudFog className={`${className} text-slate-300`} />;
  if ([51, 53, 55, 56, 57].includes(code))
    return <CloudDrizzle className={`${className} text-blue-300`} />;
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return <CloudRain className={`${className} text-blue-300`} />;
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return <CloudSnow className={`${className} text-cyan-200`} />;
  if ([95, 96, 99].includes(code))
    return <CloudLightning className={`${className} text-amber-300`} />;
  return <Sun className={`${className} text-yellow-300`} />;
}

export function wmoToText(code: number): string {
  if (code === 0) return "Clear Sky";
  if ([1, 2].includes(code)) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing Drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain Showers";
  if ([85, 86].includes(code)) return "Snow Showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Clear";
}
