import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import { backgroundQuerySchema } from "./background.validation";
import * as backgroundService from "./background.service";

export async function getBackground(req: Request, res: Response): Promise<void> {
  const parsed = backgroundQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => e.message).join(", ");
    throw new ApiError(messages, 400);
  }

  const data = await backgroundService.getBackground(parsed.data.query);

  res.status(200).json({ success: true, data });
}
