import { Router } from "express";
import * as controller from "./background.controller";

const router = Router();

// No auth — public background image curated from Unsplash.
router.get("/", controller.getBackground);

export default router;
