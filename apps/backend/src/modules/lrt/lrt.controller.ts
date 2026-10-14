import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import { timetableQuerySchema, routeSearchQuerySchema } from "./lrt.validation";
import * as lrtService from "./lrt.service";

// GET /api/lrt/timetable?date=YYYY-MM-DD&direction=INBOUND|OUTBOUND&dayType=WEEKDAY|HOLIDAY
export async function getTimetable(req: Request, res: Response): Promise<void> {
  const parsed = timetableQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => e.message).join(", ");
    throw new ApiError(messages, 400);
  }
  const data = await lrtService.getTimetable({
    date: parsed.data.date,
    direction: parsed.data.direction,
    dayType: parsed.data.dayType,
  });
  res.status(200).json({ success: true, data });
}

// GET /api/lrt/stations
export async function getStations(_req: Request, res: Response): Promise<void> {
  const stations = await lrtService.listStations();
  res.status(200).json({ success: true, data: { stations } });
}

// GET /api/lrt/search?date=YYYY-MM-DD&from=<code|name>&to=<code|name>&dayType=…&includeStops=true
export async function searchRoute(req: Request, res: Response): Promise<void> {
  const parsed = routeSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => e.message).join(", ");
    throw new ApiError(messages, 400);
  }
  const data = await lrtService.searchRoute({
    date: parsed.data.date,
    from: parsed.data.from,
    to: parsed.data.to,
    dayType: parsed.data.dayType,
    includeStops: parsed.data.includeStops,
  });
  res.status(200).json({ success: true, data });
}