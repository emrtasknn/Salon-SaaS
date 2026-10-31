import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaServiceRepository } from "./prisma-service-management";
import { createPrismaStaffRepository } from "./prisma-staff-management";
import { createPrismaWorkingHoursRepository } from "./prisma-working-hours-management";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = {
  tenantId: string;
  slug: string;
  staffProfileId: string;
  staffId: string;
  serviceId: string;
  mondayHoursId: string;
  tuesdayHoursId: string;
};

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `management-isolation-${label}-${suffix}`,
    slug: `management-isolation-${label}-${suffix}`,
    staffProfileId: `management-staff-profile-${label}-${suffix}`,
    staffId: `management-staff-${label}-${suffix}`,
    serviceId: `management-service-${label}-${suffix}`,
    mondayHoursId: `management-monday-${label}-${suffix}`,
    tuesdayHoursId: `management-tuesday-${label}-${suffix}`,
  };
}

describeDatabase("Prisma management repositories tenant isolation integration", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const seedTenant = async (fixture: Fixture, label: string, includeTuesday: boolean) => {
    if (!pool) throw new Error("Database pool was not initialized");
    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Management Tenant ${label}`],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [fixture.staffProfileId, fixture.tenantId, `Staff ${label}`],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    await pool.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [fixture.mondayHoursId, fixture.tenantId],
    );
    if (includeTuesday) {
      await pool.query(
        `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
         VALUES ($1, $2, 2, 600, 1020, now(), now())`,
        [fixture.tuesdayHoursId, fixture.tenantId],
      );
    }
  };

  const cleanupTenant = async (fixture: Fixture) => {
    if (!pool) return;
    await pool.query('DELETE FROM "CustomerNote" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA, "A", false);
    await seedTenant(tenantB, "B", true);
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const errors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        errors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      errors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("keeps service list, update, and activation tenant-scoped", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaServiceRepository(prisma as unknown as PrismaTenantClient);
    const contextA = { tenantId: tenantA.tenantId as never };

    expect((await repository.list(contextA)).map((service) => service.id)).toEqual([tenantA.serviceId]);
    await expect(repository.update(contextA, tenantB.serviceId, { name: "Cross-tenant update" }))
      .resolves.toBe("not_found");
    await expect(repository.setActive(contextA, tenantB.serviceId, false)).resolves.toBe("not_found");

    const persisted = await pool.query(
      'SELECT "name", "active" FROM "Service" WHERE "tenantId" = $1 AND "id" = $2',
      [tenantB.tenantId, tenantB.serviceId],
    );
    expect(persisted.rows).toEqual([{ name: "Service B", active: true }]);
  });

  it("keeps staff list, profile update, and status changes tenant-scoped", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaStaffRepository(prisma as unknown as PrismaTenantClient);
    const contextA = { tenantId: tenantA.tenantId as never };

    expect((await repository.list(contextA)).map((staff) => staff.id)).toEqual([tenantA.staffId]);
    await expect(repository.updateProfile(contextA, tenantB.staffId, { displayName: "Cross-tenant update" }))
      .resolves.toBe("not_found");
    await expect(repository.setStatus(contextA, tenantB.staffId, "INACTIVE")).resolves.toBe("not_found");

    const persisted = await pool.query(
      `SELECT s."status", p."displayName"
       FROM "Staff" s
       JOIN "Profile" p ON p."tenantId" = s."tenantId" AND p."id" = s."profileId"
       WHERE s."tenantId" = $1 AND s."id" = $2`,
      [tenantB.tenantId, tenantB.staffId],
    );
    expect(persisted.rows).toEqual([{ status: "ACTIVE", displayName: "Staff B" }]);
  });

  it("does not remove or overwrite another tenant's working hours by day identifier", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaWorkingHoursRepository(prisma as unknown as PrismaTenantClient);
    const contextA = { tenantId: tenantA.tenantId as never };

    expect((await repository.list(contextA)).map((hours) => hours.dayOfWeek)).toEqual([1]);
    await expect(repository.remove(contextA, 2)).resolves.toBe("not_found");
    await expect(repository.upsert(contextA, {
      dayOfWeek: 2,
      openMinute: 660,
      closeMinute: 1020,
    })).resolves.toBe("created");

    const persistedB = await pool.query(
      'SELECT "openMinute", "closeMinute" FROM "WorkingHours" WHERE "tenantId" = $1 AND "dayOfWeek" = 2',
      [tenantB.tenantId],
    );
    expect(persistedB.rows).toEqual([{ openMinute: 600, closeMinute: 1020 }]);
  });
});
