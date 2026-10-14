import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as controller from "./folders.controller";
import { createFolderSchema, updateFolderSchema } from "./folders.validation";

const router = Router();

router.use(authenticate);

router.post("/", validate(createFolderSchema), controller.createFolder);
router.get("/", controller.listFolders);
router.get("/:id", controller.getFolder);
router.patch("/:id", validate(updateFolderSchema), controller.updateFolder);
router.delete("/:id", controller.deleteFolder);

export default router;
