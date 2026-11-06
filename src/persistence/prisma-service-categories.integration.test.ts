import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaServiceCategoryRepository } from "./prisma-service-categories";
import { createPrismaServiceRepository } from "./prisma-service-management";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// Owner decision 2026-11-06: two-tenant integration test for "ServiceCategory" and the new
// "Service" price/category columns (RLS, composite FK, CHECKs, repository behaviour).
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = { tenantId: string; slug: string; serviceId: string; categoryId: string };

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `svccat-${label}-${suffix}`,
    slug: `svccat-${label}-${suffix}`,
    serviceId: `svccat-service-${label}-${suffix}`,
    categoryId: `svccat-category-${label}-${suffix}`,
  };
}

describeDatabase("ServiceCategory + Service price integration (owner decision 2026-11-06)", () => {
  const role = `svccat_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  const client = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaTenantClient;
  };
  const ctx = (fixture: Fixture) => ({ tenantId: fixture.tenantId as never });

  /** Runs `operation` in a transaction that is always rolled back. `asRole` drops superuser/owner bypass. */
  const inRolledBackTx = async <T>(
    options: Readonly<{ tenantId: string | null; asRole: boolean }>,
    operation: (c: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      if (options.asRole) await c.query(`SET LOCAL ROLE "${role}"`);
      if (options.tenantId) await c.query("SELECT set_config('app.tenant_id', $1, true)", [options.tenantId]);
      return await operation(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.query("RESET ROLE").catch(() => undefined);
      c.release();
    }
  };

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Category Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "ServiceCategory" ("id", "tenantId", "name", "sortOrder", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 1, now(), now())`,
      [fixture.categoryId, fixture.tenantId, `Saç ${label}`],
    );
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "categoryId", "priceMinor", "priceIsFrom", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, $4, 45000, false, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Kesim ${label}`, fixture.categoryId],
    );
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "ServiceCategory" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    // Non-owner, non-superuser role so RLS is actually evaluated (CI connects as a superuser).
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "ServiceCategory", "Service" TO "${role}"`);
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        errors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    if (roleCreated) {
      try {
        await pool.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON "ServiceCategory", "Service" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      } catch (error) {
        errors.push(`test role cleanup failed: ${String(error)}`);
      }
    }
    await prisma?.$disconnect().catch((error) => errors.push(String(error)));
    await pool.end().catch((error) => errors.push(String(error)));
    if (errors.length > 0) throw new Error(errors.join("\n"));
  });

  it("RLS: a tenant sees and changes only its own categories", async () => {
    const visible = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('SELECT "id" FROM "ServiceCategory" WHERE "id" IN ($1, $2)', [tenantA.categoryId, tenantB.categoryId]));
    expect(visible.rows.map((row) => row.id)).toEqual([tenantA.categoryId]);

    const updated = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query(`UPDATE "ServiceCategory" SET "name" = 'x' WHERE "id" = $1`, [tenantB.categoryId]));
    expect(updated.rowCount).toBe(0);

    const deleted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('DELETE FROM "ServiceCategory" WHERE "id" = $1', [tenantB.categoryId]));
    expect(deleted.rowCount).toBe(0);
  });

  it("RLS: no rows without a tenant context, and inserts for another tenant are rejected", async () => {
    const none = await inRolledBackTx({ tenantId: null, asRole: true }, (c) => c.query('SELECT "id" FROM "ServiceCategory"'));
    expect(none.rowCount).toBe(0);
    await expect(inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query(`INSERT INTO "ServiceCategory" ("id", "tenantId", "name", "updatedAt") VALUES ($1, $2, 'Sızma', now())`,
        [`leak-${randomUUID()}`, tenantB.tenantId]),
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("composite FK: a service cannot point at another tenant's category", async () => {
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query('UPDATE "Service" SET "categoryId" = $1 WHERE "id" = $2', [tenantB.categoryId, tenantA.serviceId]),
    )).rejects.toMatchObject({ code: "23503", constraint: "Service_category_tenant_fkey" });

    const result = await createPrismaServiceRepository(client()).update(ctx(tenantA), tenantA.serviceId, { categoryId: tenantB.categoryId });
    expect(result).toBe("category_not_found");
  });

  it("CHECKs: price range, starting price needs a price, blank category name", async () => {
    const run = (sql: string, params: unknown[]) => inRolledBackTx({ tenantId: null, asRole: false }, (c) => c.query(sql, params));
    await expect(run('UPDATE "Service" SET "priceMinor" = -1 WHERE "id" = $1', [tenantA.serviceId]))
      .rejects.toMatchObject({ code: "23514", constraint: "Service_priceMinor_range_check" });
    await expect(run('UPDATE "Service" SET "priceMinor" = 10000001 WHERE "id" = $1', [tenantA.serviceId]))
      .rejects.toMatchObject({ code: "23514", constraint: "Service_priceMinor_range_check" });
    await expect(run('UPDATE "Service" SET "priceMinor" = NULL, "priceIsFrom" = true WHERE "id" = $1', [tenantA.serviceId]))
      .rejects.toMatchObject({ code: "23514", constraint: "Service_priceIsFrom_requires_price_check" });
    await expect(run(`UPDATE "ServiceCategory" SET "name" = '   ' WHERE "id" = $1`, [tenantA.categoryId]))
      .rejects.toMatchObject({ code: "23514", constraint: "ServiceCategory_name_not_blank_check" });
  });

  it("repository: create appends, rename conflicts, move reorders, remove detaches services", async () => {
    const repo = createPrismaServiceCategoryRepository(client());
    expect(await repo.create(ctx(tenantA), "Tırnak A")).toBe("created");
    expect(await repo.create(ctx(tenantA), "Tırnak A")).toBe("conflict");
    let list = await repo.list(ctx(tenantA));
    expect(list.map((c) => c.name)).toEqual(["Saç A", "Tırnak A"]);

    const nail = list[1];
    expect(await repo.rename(ctx(tenantA), nail.id, "Saç A")).toBe("conflict");
    expect(await repo.rename(ctx(tenantA), tenantB.categoryId, "x")).toBe("not_found");

    expect(await repo.move(ctx(tenantA), nail.id, "up")).toBe("updated");
    list = await repo.list(ctx(tenantA));
    expect(list.map((c) => c.name)).toEqual(["Tırnak A", "Saç A"]);

    expect(await repo.remove(ctx(tenantA), tenantB.categoryId)).toBe("not_found");
    expect(await repo.remove(ctx(tenantA), tenantA.categoryId)).toBe("deleted");
    const service = await db().query('SELECT "categoryId", "priceMinor" FROM "Service" WHERE "id" = $1', [tenantA.serviceId]);
    expect(service.rows[0]).toEqual({ categoryId: null, priceMinor: 45000 });
    // Tenant B is untouched.
    expect((await repo.list(ctx(tenantB))).map((c) => c.id)).toEqual([tenantB.categoryId]);
  });

  it("service repository writes and reads price and category", async () => {
    const repo = createPrismaServiceRepository(client());
    expect(await repo.update(ctx(tenantB), tenantB.serviceId, { priceMinor: 60000, priceIsFrom: true, categoryId: null })).toBe("updated");
    const [row] = (await repo.list(ctx(tenantB))).filter((s) => s.id === tenantB.serviceId);
    expect(row).toMatchObject({ categoryId: null, priceMinor: 60000, priceIsFrom: true });
  });
});
