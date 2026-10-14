import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import * as userService from "./user.service";

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await userService.findAllUsers();
  res.status(200).json({ success: true, data: users });
}

export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }

  const user = await userService.findUserById(userId);
  if (!user) {
    throw new ApiError("User not found", 404);
  }

  res.status(200).json({ success: true, data: user });
}
