import type { Request, Response } from "express";
import * as quoteService from "./quotes.service";

export function getQuote(_req: Request, res: Response): void {
  const data = quoteService.getQuote();
  res.status(200).json({ success: true, data });
}
