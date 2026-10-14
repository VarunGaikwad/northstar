import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: connection URL for the CLI (migrations / introspection / studio)
// lives here instead of the schema. The runtime PrismaClient uses a driver
// adapter (see src/db/prisma.ts) and does NOT read this URL.
// Generation needs no database credentials; database commands still require a URL.
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
