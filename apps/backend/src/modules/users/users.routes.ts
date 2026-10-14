import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import * as controller from "./users.controller";

const router = Router();

router.get("/", controller.getUsers);
router.get("/me", authenticate, controller.getCurrentUser);

export default router;
