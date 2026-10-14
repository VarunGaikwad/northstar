import type { LrtDayType, LrtDirection, LrtStopType, LrtTrainType } from "@prisma/client";

export type StationDTO = {
  code: number;
  name: string;
  nameEn: string | null;
  nameRomaji: string | null;
};

export type StopDTO = {
  stopSequence: number;
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  arrival: string | null; // "H:MM"
  departure: string | null; // "H:MM"
  isNextDay: boolean;
  stopType: LrtStopType; // STOP | PASS | NOSERVICE
};

export type TripDTO = {
  tripIndex: number;
  dayType: LrtDayType;
  direction: LrtDirection;
  trainType: LrtTrainType;
  firstDeparture: string; // "H:MM"
  firstDepartureNextDay: boolean;
  stopsServed: number; // count of STOP stops
  stops: StopDTO[];
};

export type DirectionTimetable = {
  direction: LrtDirection;
  tripCount: number;
  trips: TripDTO[];
};

export type LrtTimetableResponse = {
  date: string; // YYYY-MM-DD
  dayType: LrtDayType;
  isToday: boolean;
  directions: DirectionTimetable[];
};

export type LrtStationsResponse = {
  stations: StationDTO[];
};

// ── Route search: from/to over a given date ─────────────────────────────
export type RouteStopDTO = {
  stationCode: number;
  stationName: string;
  stationNameEn: string | null;
  time: string | null; // "H:MM" — departure at origin, arrival at destination
  isNextDay: boolean;
};

export type RouteTripDTO = {
  tripIndex: number;
  trainType: LrtTrainType;
  direction: LrtDirection;
  from: RouteStopDTO;
  to: RouteStopDTO;
  durationMins: number; // travel time origin-depart → destination-arrive
  stopsBetween: number; // number of STOP stations the passenger rides through
  stops: StopDTO[]; // full journey stops (same shape as timetable endpoint)
};

export type LrtRouteSearchResponse = {
  date: string;
  dayType: LrtDayType;
  isToday: boolean;
  from: StationDTO;
  to: StationDTO;
  direction: LrtDirection;
  tripCount: number;
  trips: RouteTripDTO[];
};