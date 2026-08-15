export type ApiSuccess<T> = { success: true; data: T };
export type ApiMessage = { success: true; message: string };
export type ApiError = { success: false; error: string };

export type Role = "USER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: string;
  session: {
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FavLink {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeatherLocation {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  source: "ip" | "user";
  cityId: number;
  timezone: number;
}

export interface WeatherConditionItem {
  id: number;
  main: string;
  description: string;
  icon: string;
}

export interface WeatherMain {
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  pressure: number;
  humidity: number;
  seaLevel: number;
  grndLevel: number;
}

export interface WeatherWind {
  speed: number;
  deg: number;
  gust: number;
}

export interface WeatherClouds {
  all: number;
}

export interface WeatherSys {
  country: string;
  sunrise: number;
  sunset: number;
}

export interface WeatherConditions {
  temperature: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  condition: string;
  conditionCode: number;
  conditionMain: string;
  conditionIcon: string;
  humidity: number;
  pressure: number;
  seaLevel: number;
  grndLevel: number;
  visibility: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  cloudCoverage: number;
  sunrise: number;
  sunset: number;
  country: string;
  timestamp: number;
}

export interface WeatherResponse {
  location: WeatherLocation;
  weather: WeatherConditions;
  conditions: WeatherConditionItem[];
  main: WeatherMain;
  wind: WeatherWind;
  clouds: WeatherClouds;
  sys: WeatherSys;
  base: string;
  cod: number;
}

export interface BackgroundImage {
  url: string;
  alt: string;
  unsplashUrl: string;
  photographer: {
    name: string;
    username: string;
    profileUrl: string;
  };
}

export interface BackgroundResponse {
  image: BackgroundImage;
}

export interface Quote {
  text: string;
  author: string | null;
}

export interface QuoteResponse {
  quote: Quote;
}

export type LrtDayType = "WEEKDAY" | "HOLIDAY";
export type LrtDirection = "INBOUND" | "OUTBOUND";
export type LrtTrainType = "LOCAL" | "RAPID";
export type LrtStopType = "STOP" | "PASS" | "NOSERVICE";

export interface Station {
  code: number;
  name: string;
  nameEn: string | null;
  nameRomaji: string | null;
}

export interface Stop {
  stopSequence: number;
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  arrival: string | null;
  departure: string | null;
  isNextDay: boolean;
  stopType: LrtStopType;
}

export interface Trip {
  tripIndex: number;
  dayType: LrtDayType;
  direction: LrtDirection;
  trainType: LrtTrainType;
  firstDeparture: string;
  firstDepartureNextDay: boolean;
  stopsServed: number;
  stops: Stop[];
}

export interface DirectionTimetable {
  direction: LrtDirection;
  tripCount: number;
  trips: Trip[];
}

export interface LrtTimetableResponse {
  date: string;
  dayType: LrtDayType;
  isToday: boolean;
  directions: DirectionTimetable[];
}

export interface LrtStationsResponse {
  stations: Station[];
}

export interface RouteStop {
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  time: string | null;
  isNextDay: boolean;
}

export interface RouteTrip {
  tripIndex: number;
  trainType: LrtTrainType;
  direction: LrtDirection;
  from: RouteStop;
  to: RouteStop;
  durationMins: number;
  stopsBetween: number;
  stops: Stop[];
}

export interface LrtRouteSearchResponse {
  date: string;
  dayType: LrtDayType;
  isToday: boolean;
  from: Station;
  to: Station;
  direction: LrtDirection;
  tripCount: number;
  trips: RouteTrip[];
}

export type AttendanceField = "CHECK_IN" | "CHECK_OUT";

export interface AttendanceEdit {
  id: string;
  field: AttendanceField;
  oldValue: string | null;
  oldValueLocal: string | null;
  newValue: string | null;
  newValueLocal: string | null;
  reason: string | null;
  editedAt: string;
  editedByUserId: string;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string;
  timezone: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInLocal: string | null;
  checkOutLocal: string | null;
  workedMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  edits: AttendanceEdit[];
}

export interface AttendanceDay {
  date: string;
  timezone: string;
  attendance: Attendance | null;
}

export interface AttendanceRange {
  from: string;
  to: string;
  timezone: string;
  count: number;
  records: Attendance[];
}

export interface AttendanceSummary {
  daysPresent: number;
  daysCompleted: number;
  daysClockedOutPending: number;
  totalWorkedMinutes: number;
  averageWorkedMinutes: number | null;
  longestDayMinutes: number | null;
  shortestDayMinutes: number | null;
}

export interface AttendanceMonth {
  month: string;
  timezone: string;
  from: string;
  to: string;
  daysInMonth: number;
  count: number;
  summary: AttendanceSummary;
  records: Attendance[];
}

export interface AttendanceEditHistory {
  edits: AttendanceEdit[];
}
