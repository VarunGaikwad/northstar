import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import * as controller from "./notes.controller";

const router = Router();

router.use(authenticate);

router.post("/", controller.createNote);
router.get("/", controller.listNotes);
router.get("/:noteId", controller.getNote);
router.patch("/:noteId", controller.patchNote);
router.post("/:noteId/archive", controller.archiveNote);
router.post("/:noteId/unarchive", controller.unarchiveNote);
router.post("/:noteId/trash", controller.trashNote);
router.post("/:noteId/restore", controller.restoreNote);
router.delete("/:noteId", controller.permanentlyDeleteNote);
router.post(
  "/:noteId/images/upload-intents",
  controller.createImageUploadIntent,
);
router.post(
  "/:noteId/images/:imageId/confirm",
  controller.confirmNoteImage,
);
router.put("/:noteId/images/order", controller.reorderNoteImages);
router.delete("/:noteId/images/:imageId", controller.deleteNoteImage);

export default router;
