import cors from "cors";
import express, { type Request, type Response } from "express";

import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";

import attendanceRoutes from "./modules/attendance/attendance.routes";
import authRoutes from "./modules/auth/auth.routes";
import backgroundRoutes from "./modules/background/background.routes";
import favlinkRoutes from "./modules/favlinks/favlinks.routes";
import folderRoutes from "./modules/folders/folders.routes";
import lrtRoutes from "./modules/lrt/lrt.routes";
import quoteRoutes from "./modules/quotes/quotes.routes";
import userRoutes from "./modules/users/users.routes";
import weatherRoutes from "./modules/weather/weather.routes";

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      // Chrome extensions may have different IDs.
      if (!origin || origin.startsWith("chrome-extension://")) {
        return callback(null, true);
      }

      // Allow your web frontend
      if (env.FRONTEND_URLS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/", (_req: Request, res: Response) => {
  res.send("Hello, NorthStar ⭐!");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/favlinks", favlinkRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/lrt", lrtRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/background", backgroundRoutes);
app.use("/api/quote", quoteRoutes);

app.use(errorHandler);

export default app;
