import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import { weatherQuerySchema } from "./weather.validation";
import * as weatherService from "./weather.service";

export async function getWeather(req: Request, res: Response): Promise<void> {
  // Validate query params
  const parsed = weatherQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => e.message).join(", ");
    throw new ApiError(messages, 400);
  }

  // Resolve client IP – trust proxy if behind a reverse proxy
  const clientIp =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  const data = await weatherService.getWeather(parsed.data.lat, parsed.data.lon, clientIp);

  res.status(200).json({ success: true, data });
}
