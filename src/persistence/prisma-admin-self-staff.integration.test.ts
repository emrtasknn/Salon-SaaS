import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createAdminServesAsStaff } from "../application/staff-management";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { createPrismaAdminSelfStaffRepository } from "./prisma-staff-management";
import { createPrismaMembershipReader } from "./prisma-membership-reader";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// Owner decision 2026-11-05: a TENANT_ADMIN can also serve customers as staff. Two-tenant test of the
// admin's own Staff row under FORCE RLS, run as a non-owner, non-superuser role so RLS is evaluated.
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = { tenantId: string; slug: string; adminProfileId: string; adminSubjectId: string; membershipId: string };

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `admin-self-staff-${label}-${suffix}`,
    slug: `admin-self-staff-${label}-${suffix}`,
    adminProfileId: `admin-self-staff-profile-${label}-${suffix}`,
    adminSubjectId: randomUUID(),
    membershipId: `admin-self-staff-membership-${label}-${suffix}`,
  };
}

describeDatabase("Admin serves as staff: own Staff row under RLS (integration)", () => {
  const role = `admin_self_staff_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const tables = ["Staff", "Profile", "TenantMembership", "Service", "WorkingHours"];
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  /** Every tenant transaction runs as the RLS-subject test role (no owner/superuser bypass). */
  const roleClient = (): PrismaTenantClient => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const client = prisma;
    return {
      $transaction: (operation) =>
        client.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
          return operation(tx as never);
        }),
    } as PrismaTenantClient;
  };
  const ctx = (fixture: Fixture) => ({ tenantId: fixture.tenantId as never });
  const identityOf = (fixture: Fixture) => createAuthenticatedIdentity(fixture.adminSubjectId, fixture.adminProfileId);

  const useCase = () => {
    const client = roleClient();
    const reader = createPrismaMembershipReader({ prisma: client });
    return createAdminServesAsStaff({
      membershipReader: {
        async readOwnMembership(identity, tenantContext) {
          const membership = await reader.readMembership({ tenantContext, identity });
          return membership.status === "found" ? membership.membership : null;
        },
      },
      repository: createPrismaAdminSelfStaffRepository(client),
    });
  };

  const staffRows = async (profileId: string) =>
    (await db().query<{ id: string; tenantId: string; status: string }>(
      `SELECT "id", "tenantId", "status" FROM "Staff" WHERE "profileId" = $1`, [profileId])).rows;

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Admin Self Staff ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
      [fixture.adminProfileId, fixture.tenantId, `Admin ${label}`],
    );
    await p.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'TENANT_ADMIN', now(), now())`,
      [fixture.membershipId, fixture.tenantId, fixture.adminSubjectId, fixture.adminProfileId],
    );
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "TenantMembership" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    for (const table of tables) await pool.query(`GRANT SELECT, INSERT, UPDATE ON "${table}" TO "${role}"`);
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool) return;
    const cleanupErrors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    if (roleCreated) {
      try {
        for (const table of tables) await pool.query(`REVOKE SELECT, INSERT, UPDATE ON "${table}" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      } catch (error) {
        cleanupErrors.push(`test role cleanup failed: ${String(error)}`);
      }
    }
    try {
      await prisma?.$disconnect();
    } catch (error) {
      cleanupErrors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      cleanupErrors.push(`pool end failed: ${String(error)}`);
    }
    if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join("\n"));
  });

  it("enables, lists in the vitrin, disables and reactivates the admin's own single Staff row", async () => {
    await expect(useCase().read(identityOf(tenantA), ctx(tenantA))).resolves.toEqual({ status: "ok", servesAsStaff: false });

    await expect(useCase().set(identityOf(tenantA), ctx(tenantA), true)).resolves.toEqual({ status: "ok", servesAsStaff: true });
    const created = await staffRows(tenantA.adminProfileId);
    expect(created).toEqual([{ id: expect.any(String), tenantId: tenantA.tenantId, status: "ACTIVE" }]);
    await expect(useCase().read(identityOf(tenantA), ctx(tenantA))).resolves.toEqual({ status: "ok", servesAsStaff: true });

    const vitrin = createPrismaPublicSalonRepository(roleClient());
    const listed = await vitrin.catalog(ctx(tenantA));
    expect(listed.staff).toEqual([expect.objectContaining({ id: created[0].id, profileId: tenantA.adminProfileId, displayName: "Admin A" })]);
    // The other tenant's vitrin never sees tenant A's admin-staff.
    expect((await vitrin.catalog(ctx(tenantB))).staff).toEqual([]);

    await expect(useCase().set(identityOf(tenantA), ctx(tenantA), false)).resolves.toEqual({ status: "ok", servesAsStaff: false });
    expect(await staffRows(tenantA.adminProfileId)).toEqual([{ id: created[0].id, tenantId: tenantA.tenantId, status: "INACTIVE" }]);
    expect((await vitrin.catalog(ctx(tenantA))).staff).toEqual([]);

    await useCase().set(identityOf(tenantA), ctx(tenantA), true);
    expect(await staffRows(tenantA.adminProfileId)).toEqual([{ id: created[0].id, tenantId: tenantA.tenantId, status: "ACTIVE" }]);
  });

  it("cannot read or change the admin's Staff row from another tenant's context", async () => {
    // Self-contained: make sure tenant A's admin row exists and is ACTIVE.
    await expect(useCase().set(identityOf(tenantA), ctx(tenantA), true)).resolves.toEqual({ status: "ok", servesAsStaff: true });
    // Tenant A's admin identity has no membership in tenant B, so the use case refuses.
    await expect(useCase().set(identityOf(tenantA), ctx(tenantB), true)).resolves.toEqual({ status: "UNAUTHORIZED" });

    // The repository itself, called with tenant B's context, sees nothing and cannot write tenant A's row.
    const repository = createPrismaAdminSelfStaffRepository(roleClient());
    await expect(repository.findOwnStatus(ctx(tenantB), tenantA.adminProfileId)).resolves.toBeNull();
    await expect(repository.setOwnStatus(ctx(tenantB), tenantA.adminProfileId, "INACTIVE")).resolves.toBe("not_found");
    await expect(repository.setOwnStatus(ctx(tenantB), tenantA.adminProfileId, "ACTIVE")).rejects.toBeTruthy();
    expect(await staffRows(tenantA.adminProfileId)).toEqual([expect.objectContaining({ tenantId: tenantA.tenantId, status: "ACTIVE" })]);
  });

  it("disabling without a Staff row creates nothing", async () => {
    await expect(useCase().set(identityOf(tenantB), ctx(tenantB), false)).resolves.toEqual({ status: "ok", servesAsStaff: false });
    expect(await staffRows(tenantB.adminProfileId)).toEqual([]);
  });
});
