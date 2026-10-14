import { Router } from "express";
import * as controller from "./quotes.controller";

const router = Router();

// No auth — daily quote from bundled curated list.
router.get("/", controller.getQuote);

export default router;
