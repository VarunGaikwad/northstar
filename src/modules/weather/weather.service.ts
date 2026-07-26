import { ApiError } from "../../utils/ApiError";
import { env } from "../../config/env";
import type {
  WeatherConditions,
  WeatherLocation,
  WeatherResponse,
  WeatherCondition,
  WeatherMain,
  WeatherWind,
  WeatherSys,
} from "./weather.types";

// ── IP geolocation via ip-api.com ────────────────────────────────────
async function locateByIp(ip: string): Promise<WeatherLocation> {
  const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon`);

  if (!res.ok) {
    throw new ApiError("Failed to determine location from IP address", 502);
  }

  const body = await res.json() as {
    status: string;
    country: string;
    regionName: string;
    city: string;
    lat: number;
    lon: number;
  };

  if (body.status !== "success") {
    throw new ApiError("Could not geolocate your IP address", 404);
  }

  return {
    city: body.city || "Unknown",
    region: body.regionName || "",
    country: body.country || "Unknown",
    lat: body.lat,
    lon: body.lon,
    source: "ip",
    cityId: null,
    timezone: null,
  };
}

// ── OpenWeatherMap current conditions fetch ──────────────────────────
async function fetchWeather(
  lat: number,
  lon: number,
): Promise<{
  weather: WeatherConditions;
  conditions: WeatherCondition[];
  main: WeatherMain;
  wind: WeatherWind;
  clouds: { all: number };
  rain?: { "1h": number };
  sys: WeatherSys;
  base: string;
  cod: number;
  cityName: string;
  cityId: number;
  timezone: number;
}> {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new ApiError("OPENWEATHER_API_KEY is not configured", 500);
  }

  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    appid: apiKey,
    units: "metric",
  });

  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`);

  if (!res.ok) {
    const msg = await res.text().catch(() => "Unknown error");
    throw new ApiError(`OpenWeatherMap API error: ${msg}`, 502);
  }

  const body = (await res.json()) as {
    base: string;
    clouds: { all: number };
    cod: number;
    dt: number;
    id: number;
    name: string;
    timezone: number;
    visibility: number;
    weather: { id: number; main: string; description: string; icon: string }[];
    main: {
      temp: number;
      feels_like: number;
      temp_min: number;
      temp_max: number;
      pressure: number;
      humidity: number;
      sea_level?: number;
      grnd_level?: number;
    };
    wind: { speed: number; deg: number; gust?: number };
    rain?: { "1h": number };
    sys: { country: string; sunrise: number; sunset: number };
  };

  const w = body.weather[0];

  const weather: WeatherConditions = {
    temperature: Math.round(body.main.temp * 10) / 10,
    feelsLike: Math.round(body.main.feels_like * 10) / 10,
    condition: w.description,
    conditionCode: w.id,
    conditionMain: w.main,
    conditionIcon: w.icon,
    humidity: body.main.humidity,
    pressure: body.main.pressure,
    seaLevel: body.main.sea_level,
    grndLevel: body.main.grnd_level,
    tempMin: Math.round(body.main.temp_min * 10) / 10,
    tempMax: Math.round(body.main.temp_max * 10) / 10,
    visibility: body.visibility,
    windSpeed: body.wind.speed,
    windDirection: body.wind.deg,
    windGust: body.wind.gust,
    cloudCoverage: body.clouds.all,
    rain1h: body.rain?.["1h"],
    sunrise: body.sys.sunrise,
    sunset: body.sys.sunset,
    country: body.sys.country,
    timestamp: body.dt,
  };

  const conditions: WeatherCondition[] = body.weather.map((c) => ({
    id: c.id,
    main: c.main,
    description: c.description,
    icon: c.icon,
  }));

  const main: WeatherMain = {
    temp: Math.round(body.main.temp * 10) / 10,
    feelsLike: Math.round(body.main.feels_like * 10) / 10,
    tempMin: Math.round(body.main.temp_min * 10) / 10,
    tempMax: Math.round(body.main.temp_max * 10) / 10,
    pressure: body.main.pressure,
    humidity: body.main.humidity,
    seaLevel: body.main.sea_level,
    grndLevel: body.main.grnd_level,
  };

  const wind: WeatherWind = {
    speed: body.wind.speed,
    deg: body.wind.deg,
    gust: body.wind.gust,
  };

  const sys: WeatherSys = {
    country: body.sys.country,
    sunrise: body.sys.sunrise,
    sunset: body.sys.sunset,
  };

  return {
    weather,
    conditions,
    main,
    wind,
    clouds: { all: body.clouds.all },
    rain: body.rain,
    sys,
    base: body.base,
    cod: body.cod,
    cityName: body.name,
    cityId: body.id,
    timezone: body.timezone,
  };
}

// ── Public service function ──────────────────────────────────────────
export async function getWeather(
  lat: number | undefined,
  lon: number | undefined,
  clientIp: string,
): Promise<WeatherResponse> {
  // 1. Resolve location
  let location: WeatherLocation;

  if (lat !== undefined && lon !== undefined) {
    location = {
      city: "—", // we don't reverse-geocode; user provided coordinates
      region: "",
      country: "—",
      lat,
      lon,
      source: "user",
      cityId: null,
      timezone: null,
    };
  } else {
    location = await locateByIp(clientIp);
  }

  // 2. Fetch weather
  const {
    weather,
    conditions,
    main,
    wind,
    clouds,
    rain,
    sys,
    base,
    cod,
    cityName,
    cityId,
    timezone,
  } = await fetchWeather(location.lat, location.lon);

  // 3. Fill city name + ids from OWM
  location.city = cityName || location.city;
  location.cityId = cityId ?? null;
  location.timezone = timezone ?? null;

  return { location, weather, conditions, main, wind, clouds, rain, sys, base, cod };
}
