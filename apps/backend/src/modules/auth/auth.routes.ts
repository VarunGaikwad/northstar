import { Router } from "express";
import { env } from "../../config/env";
import { limitForgotPassword, limitResetPassword } from "./password-reset-limit";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { requireTrustedAuthOrigin } from "./auth.origin";
import * as controller from "./auth.controller";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validation";

const router = Router();

router.post(
  "/register",
  requireTrustedAuthOrigin,
  validate(registerSchema),
  controller.register,
);
router.post("/login", requireTrustedAuthOrigin, validate(loginSchema), controller.login);
router.post("/refresh", requireTrustedAuthOrigin, controller.refresh);
router.post("/logout", requireTrustedAuthOrigin, controller.logout);
router.post("/logout-all", requireTrustedAuthOrigin, authenticate, controller.logoutAll);
router.post("/forgot-password", requireTrustedAuthOrigin, validate(forgotPasswordSchema), limitForgotPassword, controller.forgotPassword);
router.post(
  "/reset-password",
  (req, res, next) => {
    if (req.headers.origin === env.PUBLIC_BACKEND_URL) {
      next();
      return;
    }
    requireTrustedAuthOrigin(req, res, next);
  },
  validate(resetPasswordSchema),
  limitResetPassword,
  controller.resetPassword,
);

export default router;
