import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import * as controller from "./attendance.controller";

const router = Router();

// All attendance endpoints require authentication — each record belongs to a user.
router.use(authenticate);

// Clock in / out for today (in the supplied timezone; default UTC).
router.post("/clock-in", controller.clockIn);
router.post("/clock-out", controller.clockOut);

// Create a manual attendance record for a past date.
router.post("/", controller.createManual);

// Read your own attendance.
router.get("/me", controller.getMyDay);
router.get("/me/range", controller.getMyRange);
router.get("/me/month", controller.getMyMonth);

// Correct a record, and view its correction history.
router.patch("/:id", controller.correctRecord);
router.get("/:id/history", controller.getHistory);

export default router;