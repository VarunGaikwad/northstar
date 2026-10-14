export type WeatherLocation = {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  source: "ip" | "user";
  cityId: number | null;
  timezone: number | null;
};

export type WeatherCondition = {
  id: number;
  main: string;
  description: string;
  icon: string;
};

export type WeatherMain = {
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  pressure: number;
  humidity: number;
  seaLevel?: number;
  grndLevel?: number;
};

export type WeatherWind = {
  speed: number;
  deg: number;
  gust?: number;
};

export type WeatherSys = {
  country: string;
  sunrise: number;
  sunset: number;
};

export type WeatherConditions = {
  temperature: number;
  feelsLike: number;
  condition: string;
  conditionCode: number;
  conditionMain: string;
  conditionIcon: string;
  humidity: number;
  pressure: number;
  seaLevel?: number;
  grndLevel?: number;
  tempMin: number;
  tempMax: number;
  visibility: number;
  windSpeed: number;
  windDirection: number;
  windGust?: number;
  cloudCoverage: number;
  rain1h?: number;
  sunrise: number;
  sunset: number;
  country: string;
  timestamp: number;
};

export type WeatherResponse = {
  location: WeatherLocation;
  weather: WeatherConditions;
  conditions: WeatherCondition[];
  main: WeatherMain;
  wind: WeatherWind;
  clouds: { all: number };
  rain?: { "1h": number };
  sys: WeatherSys;
  base: string;
  cod: number;
};