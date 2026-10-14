import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import * as foldersService from "./folders.service";
import type { CreateFolderInput, UpdateFolderInput } from "./folders.validation";

function getIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ApiError("Invalid id parameter", 400);
  }
  return id;
}

export async function createFolder(req: Request<{}, {}, CreateFolderInput>, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const folder = await foldersService.create(userId, req.body);
  res.status(201).json({ success: true, data: folder });
}

export async function listFolders(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const folders = await foldersService.list(userId);
  res.status(200).json({ success: true, data: folders });
}

export async function getFolder(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const folder = await foldersService.getById(userId, getIdParam(req));
  res.status(200).json({ success: true, data: folder });
}

export async function updateFolder(req: Request<{ id: string }, {}, UpdateFolderInput>, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  const folder = await foldersService.update(userId, getIdParam(req), req.body);
  res.status(200).json({ success: true, data: folder });
}

export async function deleteFolder(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }
  await foldersService.remove(userId, getIdParam(req));
  res.status(200).json({ success: true, message: "Folder deleted successfully" });
}
