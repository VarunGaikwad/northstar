import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import {
  correctAttendanceSchema,
  clockActionSchema,
  createManualSchema,
  myDayQuerySchema,
  myMonthQuerySchema,
  myRangeQuerySchema,
} from "./attendance.validation";
import * as service from "./attendance.service";

function requireUser(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError("Unauthorized", 401);
  return userId;
}

function getIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ApiError("Invalid id parameter", 400);
  }
  return id;
}

// POST /api/attendance/clock-in   body { tz? }
export async function clockIn(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = clockActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.clockIn(userId, parsed.data.tz);
  res.status(201).json({ success: true, data });
}

// POST /api/attendance/clock-out  body { tz? }
export async function clockOut(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = clockActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.clockOut(userId, parsed.data.tz);
  res.status(200).json({ success: true, data });
}

// POST /api/attendance  body { date, checkIn?, checkOut?, tz, reason? }
export async function createManual(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = createManualSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.createManual(userId, parsed.data);
  res.status(201).json({ success: true, data });
}

// GET /api/attendance/me?date=YYYY-MM-DD&tz=...
export async function getMyDay(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = myDayQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.getMyDay(userId, parsed.data.date, parsed.data.tz);
  res.status(200).json({ success: true, data });
}

// GET /api/attendance/me/range?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=...
export async function getMyRange(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = myRangeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.getMyRange(userId, parsed.data.from, parsed.data.to, parsed.data.tz);
  res.status(200).json({ success: true, data });
}

// GET /api/attendance/me/month?month=YYYY-MM&tz=...
export async function getMyMonth(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = myMonthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.getMyMonth(userId, parsed.data.month, parsed.data.tz);
  res.status(200).json({ success: true, data });
}

// PATCH /api/attendance/:id  body { checkIn?: "HH:MM", checkOut?: "HH:MM", reason? }
export async function correctRecord(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const parsed = correctAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((e) => e.message).join(", "), 400);
  }
  const data = await service.correctAttendance(userId, getIdParam(req), parsed.data);
  res.status(200).json({ success: true, data });
}

// GET /api/attendance/:id/history
export async function getHistory(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const data = await service.getHistory(userId, getIdParam(req));
  res.status(200).json({ success: true, data: { edits: data } });
}