import { env } from "@my-app/env/server";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { PrismaClient } from "../prisma/generated/client";

const libsql = createClient({ url: env.DATABASE_URL });
const adapter = new PrismaLibSQL(libsql);
const prisma = new PrismaClient({ adapter });

export default prisma;