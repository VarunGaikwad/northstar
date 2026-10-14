import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import * as favlinksService from "./favlinks.service";
import type { CreateFavlinkInput, UpdateFavlinkInput } from "./favlinks.validation";

function getIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ApiError("Invalid id parameter", 400);
  }
  return id;
}

export async function createFavlink(req: Request<{}, {}, CreateFavlinkInput>, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const favlink = await favlinksService.create(userId, req.body);
  res.status(201).json({ success: true, data: favlink });
}

export async function listFavlinks(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const raw = req.query.folderId;
  const folderId = typeof raw === "string" && raw.length > 0 ? raw : null;
  const favlinks = await favlinksService.list(userId, folderId);
  res.status(200).json({ success: true, data: favlinks });
}

export async function getFavlink(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const favlink = await favlinksService.getById(userId, getIdParam(req));
  res.status(200).json({ success: true, data: favlink });
}

export async function updateFavlink(req: Request<{ id: string }, {}, UpdateFavlinkInput>, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const favlink = await favlinksService.update(userId, getIdParam(req), req.body);
  res.status(200).json({ success: true, data: favlink });
}

export async function deleteFavlink(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  await favlinksService.remove(userId, getIdParam(req));
  res.status(200).json({ success: true, message: "FavLink deleted successfully" });
}
