import express from "express";
import { authenticate } from "../../middleware/auth";
import * as controller from "./notes.controller";

// Isolate ETag settings to notes; mutation responses must not be re-evaluated
// against the request's old If-Match version by the hosting proxy.
const router = express();
router.disable("etag");
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

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
