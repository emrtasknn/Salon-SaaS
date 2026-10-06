import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { PrismaTenantClient } from "../persistence/prisma-tenant-context";
import { Pool } from "pg";

type RuntimePrismaClient = PrismaClient & PrismaTenantClient;

let prisma: RuntimePrismaClient | undefined;

export function getPrisma(): RuntimePrismaClient {
  if (prisma) return prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) }) as unknown as RuntimePrismaClient;
  return prisma;
}
