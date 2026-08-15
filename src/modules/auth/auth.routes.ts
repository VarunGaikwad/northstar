import { Router } from "express";
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
router.post("/forgot-password", validate(forgotPasswordSchema), controller.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), controller.resetPassword);

export default router;
