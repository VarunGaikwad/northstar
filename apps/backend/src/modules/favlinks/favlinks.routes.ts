import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import * as controller from "./favlinks.controller";
import { createFavlinkSchema, updateFavlinkSchema } from "./favlinks.validation";

const router = Router();

router.use(authenticate);

router.post("/", validate(createFavlinkSchema), controller.createFavlink);
router.get("/", controller.listFavlinks);
router.get("/:id", controller.getFavlink);
router.patch("/:id", validate(updateFavlinkSchema), controller.updateFavlink);
router.delete("/:id", controller.deleteFavlink);

export default router;
