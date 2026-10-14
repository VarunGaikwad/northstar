import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: connection URL for the CLI (migrations / introspection / studio)
// lives here instead of the schema. The runtime PrismaClient uses a driver
// adapter (see src/prisma.ts) and does NOT read this URL.
export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
});
