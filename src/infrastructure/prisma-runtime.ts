import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { Pool } from "pg";

let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return prisma;
}
