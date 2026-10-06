import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { PrismaTenantClient } from "../persistence/prisma-tenant-context";
import { Pool } from "pg";

let prisma: PrismaTenantClient | undefined;

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) }) as unknown as PrismaTenantClient;
  return prisma;
}
