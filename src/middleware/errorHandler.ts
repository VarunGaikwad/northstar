import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";

function bodyParserStatus(err: Error): 400 | 413 | null {
  const parserError = err as Error & {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  const status = parserError.status ?? parserError.statusCode;

  if (parserError.type === "entity.parse.failed" && status === 400) return 400;
  if (parserError.type === "entity.too.large" && status === 413) return 413;
  return null;
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  const parserStatus = bodyParserStatus(err);
  if (parserStatus !== null) {
    res.status(parserStatus).json({
      success: false,
      error: parserStatus === 400 ? "Invalid JSON body" : "Request body is too large",
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
}
