import { Router } from "express";
import {
  authenticateNotesCleanup,
  cleanupNotes,
} from "./notes.internal";

const router = Router();

router.get("/cleanup", authenticateNotesCleanup, cleanupNotes);

export default router;
