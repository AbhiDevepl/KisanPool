import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../prisma/generated/client";

const dbPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "dev.db",
);

const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

export default prisma;

export type * from "../prisma/generated/client";