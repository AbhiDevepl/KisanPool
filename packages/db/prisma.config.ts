import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(dirname, "prisma", "schema"),
  migrations: {
    path: path.join(dirname, "prisma", "migrations"),
  },
  datasource: {
    url: `file:${path.join(dirname, "prisma", "dev.db")}`,
  },
});
