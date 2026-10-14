import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import {
  clearRefreshCookie,
  getRefreshCookie,
  setRefreshCookie,
} from "./auth.cookies";
import * as authService from "./auth.service";
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.validation";

export async function register(req: Request<{}, {}, RegisterInput>, res: Response): Promise<void> {
  const result = await authService.register(req.body);
  setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);
  res.status(201).json({ success: true, data: result.data });
}

export async function login(req: Request<{}, {}, LoginInput>, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);
  res.status(200).json({ success: true, data: result.data });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const result = await authService.refresh(getRefreshCookie(req));
    setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);
    res.status(200).json({ success: true, data: result.data });
  } catch (error: unknown) {
    if (error instanceof ApiError && error.statusCode === 401) {
      clearRefreshCookie(req, res);
    }
    throw error;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    await authService.logout(getRefreshCookie(req));
  } finally {
    clearRefreshCookie(req, res);
  }
  res.status(200).json({ success: true, message: "Logged out successfully." });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    throw new ApiError("Unauthorized", 401);
  }

  try {
    await authService.logoutAll(userId);
  } finally {
    clearRefreshCookie(req, res);
  }
  res.status(200).json({ success: true, message: "Logged out from all sessions successfully." });
}

export async function forgotPassword(req: Request<{}, {}, ForgotPasswordInput>, res: Response): Promise<void> {
  await authService.forgotPassword(req.body);
  res.status(200).json({
    success: true,
    message: "If an account with that email exists, a reset link has been sent.",
  });
}

export async function resetPassword(req: Request<{}, {}, ResetPasswordInput>, res: Response): Promise<void> {
  await authService.resetPassword(req.body);
  res.status(200).json({
    success: true,
    message: "Password reset successfully. Please log in with your new password.",
  });
}
