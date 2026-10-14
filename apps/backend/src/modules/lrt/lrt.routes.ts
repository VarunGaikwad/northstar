import { Router } from "express";
import * as controller from "./lrt.controller";

const router = Router();

// No auth — public timetable information.
router.get("/timetable", controller.getTimetable);
router.get("/stations", controller.getStations);
router.get("/search", controller.searchRoute);

export default router;