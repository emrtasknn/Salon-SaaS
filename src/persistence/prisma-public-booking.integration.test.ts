import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { localWallTimeToUtc } from "../domain/availability";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type TenantFixture = {
  tenantId: string;
  slug: string;
  staffProfileId: string;
  staffId: string;
  serviceId: string;
  workingHoursId: string;
};

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function makeFixture(label: string): TenantFixture {
  const suffix = randomUUID();
  return {
    tenantId: `public-booking-${label}-${suffix}`,
    slug: `public-booking-${label}-${suffix}`,
    staffProfileId: `public-booking-staff-profile-${label}-${suffix}`,
    staffId: `public-booking-staff-${label}-${suffix}`,
    serviceId: `public-booking-service-${label}-${suffix}`,
    workingHoursId: `public-booking-hours-${label}-${suffix}`,
  };
}

describeDatabase("Prisma public booking tenant isolation integration", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const bookingDate = nextMondayIso();
  const startAt = localWallTimeToUtc(bookingDate, 10 * 60, "Europe/Istanbul");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const seedTenant = async (fixture: TenantFixture, label: string) => {
    if (!pool) throw new Error("Database pool was not initialized");

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Public Booking ${label}`],
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
      [fixture.workingHoursId, fixture.tenantId],
    );
  };

  const cleanupTenant = async (fixture: TenantFixture) => {
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

  const createRepository = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return createPrismaPublicBookingRepository(prisma as unknown as PrismaTenantClient);
  };

  const bookingInput = (serviceId: string, staffId: string, email: string) => ({
    serviceId,
    staffId,
    startAt,
    displayName: "Integration Customer",
    email,
    phone: null,
  });

  const expectNoCustomerOrAppointment = async (tenantId: string, email: string) => {
    if (!pool) throw new Error("Database pool was not initialized");
    const profiles = await pool.query(
      'SELECT "id" FROM "Profile" WHERE "tenantId" = $1 AND "email" = $2',
      [tenantId, email],
    );
    expect(profiles.rows).toHaveLength(0);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const cleanupErrors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      cleanupErrors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      cleanupErrors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join("\n"));
  });

  it("creates a booking with the active tenant's own service and staff", async () => {
    if (!pool) throw new Error("Database pool was not initialized");
    const email = `tenant-a-customer-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantA.serviceId, tenantA.staffId, email),
    );

    expect(result).toMatchObject({ status: "created" });
    if (typeof result !== "object" || result.status !== "created") {
      throw new Error("Expected a created booking result");
    }

    const persisted = await pool.query(
      `SELECT a."tenantId", a."serviceId", a."staffId", p."email"
       FROM "Appointment" a
       JOIN "Profile" p ON p."tenantId" = a."tenantId" AND p."id" = a."customerProfileId"
       WHERE a."id" = $1`,
      [result.appointmentId],
    );
    expect(persisted.rows).toEqual([{
      tenantId: tenantA.tenantId,
      serviceId: tenantA.serviceId,
      staffId: tenantA.staffId,
      email,
    }]);
  });

  it("rejects Tenant B's service ID in Tenant A context without creating a customer", async () => {
    const email = `cross-service-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantB.serviceId, tenantA.staffId, email),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantA.tenantId, email);
  });

  it("rejects Tenant B's staff ID in Tenant A context without creating a customer", async () => {
    const email = `cross-staff-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantA.serviceId, tenantB.staffId, email),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantA.tenantId, email);
  });

  it("enforces the same resource boundary from Tenant B to Tenant A", async () => {
    const email = `reverse-cross-tenant-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantB.tenantId as never },
      bookingInput(tenantA.serviceId, tenantA.staffId, email),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantB.tenantId, email);
  });
});
