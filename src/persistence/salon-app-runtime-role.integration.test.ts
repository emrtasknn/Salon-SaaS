import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createAuthenticatedSubjectIdentity } from "../domain/auth-identity";
import { createTenantId } from "../domain/tenant-context";
import { createPrismaMembershipReader } from "./prisma-membership-reader";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import { createPrismaRateLimitStore } from "./prisma-rate-limit";
import { findStaffByProfileId } from "./prisma-staff-lookup";
import { createPrismaTenantProvisioningRepository } from "./prisma-tenant-provisioning";
import { resolveWhatsAppTenantId } from "./prisma-whatsapp-webhook";

// Runtime-role proof (migration 20261107110000_salon_app_runtime_role).
// DATABASE_URL is the migration/fixture superuser; SALON_APP_DATABASE_URL is the
// app runtime connection as `salon_app` (NOSUPERUSER, NOBYPASSRLS). CI sets both;
// locally the suite only runs when both are provided for an isolated database.
const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.SALON_APP_DATABASE_URL;
const describeRuntimeRole = adminUrl && appUrl ? describe : describe.skip;

describe("salon_app runtime role CI wiring", () => {
  it("is configured whenever CI runs the database suite", () => {
    // Fail instead of silently skipping the RLS runtime proof in CI.
    if (process.env.CI && adminUrl) expect(appUrl, "SALON_APP_DATABASE_URL must be set in CI").toBeTruthy();
  });
});

type Fixture = {
  tenantId: string;
  slug: string;
  subjectId: string;
  profileId: string;
  membershipId: string;
  staffId: string;
  serviceId: string;
  workingHoursId: string;
  whatsappIntegrationId: string;
  phoneNumberId: string;
};

const makeFixture = (label: string): Fixture => {
  const suffix = randomUUID();
  return {
    tenantId: `salon-app-${label}-${suffix}`,
    slug: `salon-app-${label}-${suffix}`,
    subjectId: `salon-app-subject-${label}-${suffix}`,
    profileId: `salon-app-profile-${label}-${suffix}`,
    membershipId: `salon-app-membership-${label}-${suffix}`,
    staffId: `salon-app-staff-${label}-${suffix}`,
    serviceId: `salon-app-service-${label}-${suffix}`,
    workingHoursId: `salon-app-hours-${label}-${suffix}`,
    whatsappIntegrationId: `salon-app-whatsapp-${label}-${suffix}`,
    phoneNumberId: `salon-app-phone-${label}-${suffix}`,
  };
};

const tenantContext = (value: string) => {
  const result = createTenantId(value);
  if (!result.ok) throw new Error("Synthetic tenant ID is invalid");
  return { tenantId: result.value };
};

describeRuntimeRole("salon_app runtime role enforces RLS (NOBYPASSRLS)", () => {
  const fixtureA = makeFixture("a");
  const fixtureB = makeFixture("b");
  const provisionedTenantId = `salon-app-provisioned-${randomUUID()}`;
  const rateLimitKey = randomBytes(32).toString("hex");

  let admin: Pool;
  let app: Pool;
  let appPrisma: PrismaClient;

  const asApp = async <T>(tenantId: string | null, operation: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await operation(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  };

  const sqlState = async (client: PoolClient, sql: string, params: unknown[]): Promise<string | undefined> => {
    await client.query("SAVEPOINT expect_error");
    try {
      await client.query(sql, params);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expect_error");
    }
  };

  const readRowCounts = async (client: PoolClient, fixture: Fixture) => {
    const results = await Promise.all([
      client.query('SELECT "id" FROM "Profile" WHERE "id" = $1', [fixture.profileId]),
      client.query('SELECT "id" FROM "TenantMembership" WHERE "id" = $1', [fixture.membershipId]),
      client.query('SELECT "id" FROM "Staff" WHERE "id" = $1', [fixture.staffId]),
      client.query('SELECT "id" FROM "Service" WHERE "id" = $1', [fixture.serviceId]),
      client.query('SELECT "id" FROM "WorkingHours" WHERE "id" = $1', [fixture.workingHoursId]),
      client.query('SELECT "id" FROM "WhatsAppIntegration" WHERE "id" = $1', [fixture.whatsappIntegrationId]),
      client.query('SELECT count(*)::int AS n FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]),
    ]);
    return [...results.slice(0, 6).map((r) => r.rowCount), results[6].rows[0].n];
  };

  const seed = async (fixture: Fixture, label: string) => {
    await admin.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Salon App ${label}`],
    );
    await admin.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [fixture.profileId, fixture.tenantId, `Staff ${label}`],
    );
    await admin.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'STAFF', now(), now())`,
      [fixture.membershipId, fixture.tenantId, fixture.subjectId, fixture.profileId],
    );
    await admin.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.profileId],
    );
    await admin.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    await admin.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [fixture.workingHoursId, fixture.tenantId],
    );
    await admin.query(
      `INSERT INTO "WhatsAppIntegration" ("id", "tenantId", "provider", "phoneNumberId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'META_WHATSAPP', $3, 'ACTIVE', now(), now())`,
      [fixture.whatsappIntegrationId, fixture.tenantId, fixture.phoneNumberId],
    );
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
    app = new Pool({ connectionString: appUrl, connectionTimeoutMillis: 10000 });
    appPrisma = new PrismaClient({ adapter: new PrismaPg(app) });
    await seed(fixtureA, "A");
    await seed(fixtureB, "B");
  });

  afterAll(async () => {
    const errors: string[] = [];
    try {
      for (const tenantId of [fixtureA.tenantId, fixtureB.tenantId, provisionedTenantId]) {
        for (const table of ["WhatsAppIntegration", "WorkingHours", "Service", "Staff", "TenantMembership", "Profile"]) {
          await admin.query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [tenantId]);
        }
        await admin.query('DELETE FROM "Tenant" WHERE "id" = $1', [tenantId]);
      }
      await admin.query('DELETE FROM private."RateLimitBucket" WHERE "key" = $1', [rateLimitKey]);
    } catch (error) {
      errors.push(`fixture cleanup failed: ${String(error)}`);
    }
    for (const close of [() => appPrisma?.$disconnect(), () => app?.end(), () => admin?.end()]) {
      try {
        await close();
      } catch (error) {
        errors.push(`shutdown failed: ${String(error)}`);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("connects as salon_app without SUPERUSER or BYPASSRLS", async () => {
    const result = await app.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user",
    );
    expect(result.rows).toEqual([{ current_user: "salon_app", rolsuper: false, rolbypassrls: false }]);
  });

  it("returns 0 tenant rows when app.tenant_id is not set", async () => {
    expect(await asApp(null, (client) => readRowCounts(client, fixtureA))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Prisma path too: a plain query outside withPrismaTenantContext sees nothing.
    expect(await appPrisma.staff.findMany({ where: { tenantId: fixtureA.tenantId } })).toEqual([]);
  });

  it("returns 0 rows of tenant A while app.tenant_id is tenant B, and B's own rows", async () => {
    expect(await asApp(fixtureB.tenantId, (client) => readRowCounts(client, fixtureA))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await asApp(fixtureB.tenantId, (client) => readRowCounts(client, fixtureB))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(await asApp(fixtureA.tenantId, (client) => readRowCounts(client, fixtureA))).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("rejects cross-tenant and context-less writes", async () => {
    const insertProfile = `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, 'x', now(), now())`;
    const states = await asApp(fixtureB.tenantId, async (client) => [
      await sqlState(client, insertProfile, [`salon-app-cross-${randomUUID()}`, fixtureA.tenantId]),
      (await client.query('UPDATE "Staff" SET "status" = \'INACTIVE\' WHERE "id" = $1', [fixtureA.staffId])).rowCount,
      (await client.query('DELETE FROM "Service" WHERE "id" = $1', [fixtureA.serviceId])).rowCount,
    ]);
    expect(states).toEqual(["42501", 0, 0]);

    const noContext = await asApp(null, (client) =>
      sqlState(client, insertProfile, [`salon-app-nocontext-${randomUUID()}`, fixtureA.tenantId]));
    expect(noContext).toBe("42501");
  });

  it("has no access to _prisma_migrations or private tables", async () => {
    const states = await asApp(null, async (client) => [
      await sqlState(client, "SELECT 1 FROM public._prisma_migrations LIMIT 1", []),
      await sqlState(client, 'SELECT 1 FROM private."RateLimitBucket" LIMIT 1', []),
    ]);
    expect(states).toEqual(["42501", "42501"]);
  });

  // Audited pre-tenant-context runtime paths, exercised through the real repositories.
  it("public booking: resolves the tenant by slug (Tenant has no RLS) and loads the catalog in context", async () => {
    const salons = createPrismaPublicSalonRepository(appPrisma as never);
    const resolved = await salons.resolveBySlug(fixtureA.slug);
    expect(resolved?.tenantContext.tenantId).toBe(fixtureA.tenantId);
    const catalog = await salons.catalog(tenantContext(fixtureA.tenantId));
    expect(catalog.services.map((s) => s.id)).toEqual([fixtureA.serviceId]);
    expect(catalog.staff.map((s) => s.id)).toEqual([fixtureA.staffId]);
    // ServiceCategory (20261109100000) is readable by salon_app via default privileges, under RLS.
    expect(catalog.categories).toEqual([]);
  });

  it("auth: membership and staff lookups work in the trusted tenant and not across tenants", async () => {
    const reader = createPrismaMembershipReader({ prisma: appPrisma as never });
    const identity = createAuthenticatedSubjectIdentity(fixtureA.subjectId);
    const own = await reader.readMembership({ tenantContext: tenantContext(fixtureA.tenantId), identity });
    expect(own.status).toBe("found");
    const cross = await reader.readMembership({ tenantContext: tenantContext(fixtureB.tenantId), identity });
    expect(cross.status).toBe("not_found");

    expect((await findStaffByProfileId(appPrisma as never, tenantContext(fixtureA.tenantId), fixtureA.profileId))?.id).toBe(fixtureA.staffId);
    expect(await findStaffByProfileId(appPrisma as never, tenantContext(fixtureB.tenantId), fixtureA.profileId)).toBeNull();
  });

  it("platform provisioning: creates tenant, profile and membership under RLS", async () => {
    const repository = createPrismaTenantProvisioningRepository(appPrisma as never);
    const result = await repository.provision({
      tenant: {
        tenantId: provisionedTenantId as never,
        slug: provisionedTenantId,
        name: "Provisioned Salon",
        timezone: "Europe/Istanbul",
      },
      firstAdmin: { subjectId: `salon-app-owner-${randomUUID()}`, displayName: "Owner", email: "owner@example.test", phone: null },
    } as never);
    expect(result.status).toBe("created");
    const rows = await admin.query('SELECT "role" FROM "TenantMembership" WHERE "tenantId" = $1', [provisionedTenantId]);
    expect(rows.rows).toEqual([{ role: "TENANT_ADMIN" }]);
  });

  it("private SECURITY DEFINER entry points are executable (WhatsApp resolver, rate limit)", async () => {
    await expect(resolveWhatsAppTenantId(appPrisma as never, fixtureA.phoneNumberId)).resolves.toBe(fixtureA.tenantId);
    const store = createPrismaRateLimitStore(appPrisma as never);
    expect((await store.hit(rateLimitKey, "test.salon_app", 3600)).count).toBe(1);
    expect((await store.hit(rateLimitKey, "test.salon_app", 3600)).count).toBe(2);
  });
});
