import cors from "cors";
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
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
const port = env.PORT;

// CORS: allow the configured frontend origin(s) to call the API. Set
// FRONTEND_URL to a single URL or a comma-separated list in .env.
app.use(
  cors({
    origin: env.FRONTEND_URLS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Parse JSON request bodies
app.use(express.json());

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Hello route (original behavior preserved)
app.get("/", (_req: Request, res: Response) => {
  res.send("Hello, TypeScript!");
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/favlinks", favlinkRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/lrt", lrtRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/background", backgroundRoutes);
app.use("/api/quote", quoteRoutes);

// Global error handler
app.use(errorHandler);

// Graceful shutdown: disconnect Prisma before exiting
async function shutdown(signal: string) {
  console.log(`\n${signal} received, closing Prisma connection...`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
