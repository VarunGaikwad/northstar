import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { env } from "../config/env";

// Neon driver adapter (WebSocket pool) for Prisma 7. PrismaNeon builds and
// manages the underlying connection pool from this config.
const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });

// Reuse a single PrismaClient instance across hot reloads in dev to avoid
// exhausting database connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
