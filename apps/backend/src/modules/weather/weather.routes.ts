import { Router } from "express";
import * as controller from "./weather.controller";

const router = Router();

router.get("/", controller.getWeather);

export default router;
