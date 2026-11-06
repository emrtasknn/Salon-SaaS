import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaStaffServiceRepository } from "./prisma-staff-services";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// Owner decision 2026-11-06: two-tenant integration test for "StaffService" (RLS, composite FKs,
// repository behaviour, public availability enforcement).
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = { tenantId: string; slug: string; profileId: string; staffId: string; serviceId: string; otherServiceId: string; mappingId: string };

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `staffsvc-${label}-${suffix}`,
    slug: `staffsvc-${label}-${suffix}`,
    profileId: `staffsvc-profile-${label}-${suffix}`,
    staffId: `staffsvc-staff-${label}-${suffix}`,
    serviceId: `staffsvc-service-${label}-${suffix}`,
    otherServiceId: `staffsvc-other-${label}-${suffix}`,
    mappingId: `staffsvc-map-${label}-${suffix}`,
  };
}

describeDatabase("StaffService integration (owner decision 2026-11-06)", () => {
  const role = `staffsvc_test_runner_${randomUUID().replaceAll("-", "")}`;
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
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Mapping Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
      [fixture.profileId, fixture.tenantId, `Uzman ${label}`],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.profileId],
    );
    for (const [id, name] of [[fixture.serviceId, `Kesim ${label}`], [fixture.otherServiceId, `Boya ${label}`]]) {
      await p.query(
        `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt") VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
        [id, fixture.tenantId, name],
      );
    }
    await p.query(
      `INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId") VALUES ($1, $2, $3, $4)`,
      [fixture.mappingId, fixture.tenantId, fixture.staffId, fixture.serviceId],
    );
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    await p.query('DELETE FROM "StaffService" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
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
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffService" TO "${role}"`);
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
        await pool.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON "StaffService" FROM "${role}"`);
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

  it("RLS: a tenant sees and changes only its own mappings", async () => {
    const visible = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('SELECT "id" FROM "StaffService" WHERE "id" IN ($1, $2)', [tenantA.mappingId, tenantB.mappingId]));
    expect(visible.rows.map((row) => row.id)).toEqual([tenantA.mappingId]);

    const deleted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('DELETE FROM "StaffService" WHERE "id" = $1', [tenantB.mappingId]));
    expect(deleted.rowCount).toBe(0);

    await expect(inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query(`INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId") VALUES ($1, $2, $3, $4)`,
        [`x-${randomUUID()}`, tenantB.tenantId, tenantB.staffId, tenantB.otherServiceId]))).rejects.toThrow();

    const none = await inRolledBackTx({ tenantId: null, asRole: true }, (c) => c.query('SELECT count(*)::int AS n FROM "StaffService"'));
    expect(none.rows[0].n).toBe(0);
  });

  it("composite FKs reject a mapping that points at another tenant's staff or service", async () => {
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId") VALUES ($1, $2, $3, $4)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantA.staffId, tenantB.serviceId]))).rejects.toThrow(/foreign key/i);
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId") VALUES ($1, $2, $3, $4)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantB.staffId, tenantA.serviceId]))).rejects.toThrow(/foreign key/i);
  });

  it("repository: lists, replaces, clears and refuses foreign ids", async () => {
    const repository = createPrismaStaffServiceRepository(client());
    expect((await repository.list(ctx(tenantA))).get(tenantA.staffId)).toEqual([tenantA.serviceId]);

    await expect(repository.replace(ctx(tenantA), tenantA.staffId, [tenantA.otherServiceId])).resolves.toBe("updated");
    expect((await repository.list(ctx(tenantA))).get(tenantA.staffId)).toEqual([tenantA.otherServiceId]);

    await expect(repository.replace(ctx(tenantA), tenantA.staffId, [tenantB.serviceId])).resolves.toBe("invalid_service");
    await expect(repository.replace(ctx(tenantA), tenantB.staffId, [])).resolves.toBe("not_found");

    await expect(repository.replace(ctx(tenantA), tenantA.staffId, [])).resolves.toBe("updated");
    expect((await repository.list(ctx(tenantA))).has(tenantA.staffId)).toBe(false);

    // Restore the seeded mapping for the next test.
    await repository.replace(ctx(tenantA), tenantA.staffId, [tenantA.serviceId]);
    // Tenant B is untouched throughout.
    expect((await repository.list(ctx(tenantB))).get(tenantB.staffId)).toEqual([tenantB.serviceId]);
  });

  it("public availability refuses a service the staff member is not mapped to", async () => {
    const availability = createPrismaPublicAvailabilityRepository(client());
    const dateIso = "2026-12-07";
    const mapped = await availability.read(ctx(tenantA), { serviceId: tenantA.serviceId, staffId: tenantA.staffId, dateIso });
    expect(mapped.status).toBe("ok");
    const other = await availability.read(ctx(tenantA), { serviceId: tenantA.otherServiceId, staffId: tenantA.staffId, dateIso });
    expect(other).toEqual({ status: "invalid_resource" });
  });
});
