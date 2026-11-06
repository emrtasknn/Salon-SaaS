import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { PrismaTenantClient } from "../persistence/prisma-tenant-context";
import { Pool } from "pg";
import { logError } from "./log-redaction";
import { createRuntimePoolConfig } from "./prisma-pool-config";

type RuntimePrismaClient = PrismaClient & PrismaTenantClient;

let prisma: RuntimePrismaClient | undefined;

export function getPrisma(): RuntimePrismaClient {
  if (prisma) return prisma;
  const pool = new Pool(
    createRuntimePoolConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    }),
  );
  // An idle client can be dropped by the pooler; without a listener pg would
  // raise an unhandled 'error' event and crash the instance.
  pool.on("error", (error) => logError("db_pool_idle_client_error", { error }));
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) }) as unknown as RuntimePrismaClient;
  return prisma;
}
