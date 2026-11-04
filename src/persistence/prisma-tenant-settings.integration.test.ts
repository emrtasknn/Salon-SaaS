import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { localWallTimeToUtc } from "../domain/availability";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import { createPrismaPlatformTenantRepository, type PrismaPlatformTenantClient } from "./prisma-platform-tenants";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import { createPrismaTenantSettingsRepository } from "./prisma-tenant-settings";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// WP-07: two-tenant integration test for Tenant.status / Tenant.contactPhone (settings write
// isolation, E.164 CHECK, platform status toggle, inactive gates on availability and the
// admin/staff booking engine). CI only (isolated PostgreSQL); skipped without DATABASE_URL.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = {
  tenantId: string;
  slug: string;
  staffProfileId: string;
  customerProfileId: string;
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

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `tenant-settings-${label}-${suffix}`,
    slug: `tenant-settings-${label}-${suffix}`,
    staffProfileId: `tenant-settings-staff-profile-${label}-${suffix}`,
    customerProfileId: `tenant-settings-customer-profile-${label}-${suffix}`,
    staffId: `tenant-settings-staff-${label}-${suffix}`,
    serviceId: `tenant-settings-service-${label}-${suffix}`,
    workingHoursId: `tenant-settings-hours-${label}-${suffix}`,
  };
}

describeDatabase("Tenant status / contact phone tenant isolation integration (WP-07)", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const bookingDate = nextMondayIso();
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  const client = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaTenantClient;
  };
  const platformClient = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaPlatformTenantClient;
  };

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    // No status / contactPhone in the INSERT: the migration defaults are under test.
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Settings Tenant ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now())`,
      [fixture.staffProfileId, fixture.tenantId, `Staff ${label}`, fixture.customerProfileId, `Customer ${label}`],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
    );
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    await p.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [fixture.workingHoursId, fixture.tenantId],
    );
  };

  const cleanupTenant = async (fixture: Fixture) => {
    if (!pool) return;
    await pool.query('DELETE FROM "CustomerNote" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  const tenantRow = async (tenantId: string) => {
    const result = await db().query(
      'SELECT "name", "contactPhone", "status"::text AS "status", "timezone" FROM "Tenant" WHERE "id" = $1',
      [tenantId],
    );
    return result.rows[0] as { name: string; contactPhone: string | null; status: string; timezone: string } | undefined;
  };

  const setStatusRaw = (tenantId: string, status: "ACTIVE" | "INACTIVE") =>
    db().query(`UPDATE "Tenant" SET "status" = $2::"TenantStatus" WHERE "id" = $1`, [tenantId, status]);

  /** Runs `operation` with Tenant A INACTIVE and always restores ACTIVE afterwards. */
  const withTenantAInactive = async (operation: () => Promise<void>) => {
    await setStatusRaw(tenantA.tenantId, "INACTIVE");
    try {
      await operation();
    } finally {
      await setStatusRaw(tenantA.tenantId, "ACTIVE");
    }
  };

  const appointmentCount = async (tenantId: string) => {
    const result = await db().query('SELECT count(*)::int AS "count" FROM "Appointment" WHERE "tenantId" = $1', [tenantId]);
    return result.rows[0].count as number;
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

  describe("schema", () => {
    it("defaults a new tenant to ACTIVE with no contact phone", async () => {
      await expect(tenantRow(tenantA.tenantId)).resolves.toMatchObject({ status: "ACTIVE", contactPhone: null });
      await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ status: "ACTIVE", contactPhone: null });
    });

    it.each(["05551112233", "+0123456789", "+12", "+1234567890123456", "+90 555 111 22 33", ""])(
      "rejects contactPhone %j via Tenant_contactPhone_e164_check",
      async (phone) => {
        await expect(
          db().query('UPDATE "Tenant" SET "contactPhone" = $2 WHERE "id" = $1', [tenantB.tenantId, phone]),
        ).rejects.toMatchObject({ code: "23514", constraint: "Tenant_contactPhone_e164_check" });
        await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ contactPhone: null });
      },
    );

    it("accepts an E.164 phone and NULL", async () => {
      await db().query('UPDATE "Tenant" SET "contactPhone" = $2 WHERE "id" = $1', [tenantB.tenantId, "+905551112233"]);
      await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ contactPhone: "+905551112233" });
      await db().query('UPDATE "Tenant" SET "contactPhone" = NULL WHERE "id" = $1', [tenantB.tenantId]);
      await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ contactPhone: null });
    });
  });

  describe("tenant settings repository", () => {
    it("updates only the context tenant's name + phone; Tenant B, status and timezone are unchanged", async () => {
      const repository = createPrismaTenantSettingsRepository(client());
      const before = await tenantRow(tenantB.tenantId);

      await expect(repository.update({ tenantId: tenantA.tenantId as never }, { name: "Salon A Yeni", contactPhone: "+905550000001" }))
        .resolves.toBe("updated");

      await expect(tenantRow(tenantA.tenantId)).resolves.toEqual({
        name: "Salon A Yeni", contactPhone: "+905550000001", status: "ACTIVE", timezone: "Europe/Istanbul",
      });
      await expect(tenantRow(tenantB.tenantId)).resolves.toEqual(before);
      await expect(repository.read({ tenantId: tenantA.tenantId as never })).resolves.toEqual({
        name: "Salon A Yeni", contactPhone: "+905550000001", status: "ACTIVE", timezone: "Europe/Istanbul",
      });
      await expect(repository.read({ tenantId: tenantB.tenantId as never })).resolves.toMatchObject({ name: "Settings Tenant B" });
    });

    it("returns persistence_failure for a non-E.164 phone (DB CHECK) and leaves the row unchanged", async () => {
      const repository = createPrismaTenantSettingsRepository(client());
      const before = await tenantRow(tenantA.tenantId);

      await expect(repository.update({ tenantId: tenantA.tenantId as never }, { name: "Should Not Persist", contactPhone: "05551112233" }))
        .resolves.toBe("persistence_failure");
      await expect(tenantRow(tenantA.tenantId)).resolves.toEqual(before);
    });

    it("returns not_found for an unknown tenant context and changes no tenant", async () => {
      const repository = createPrismaTenantSettingsRepository(client());
      const [beforeA, beforeB] = await Promise.all([tenantRow(tenantA.tenantId), tenantRow(tenantB.tenantId)]);

      await expect(repository.update({ tenantId: `tenant-settings-missing-${randomUUID()}` as never }, { name: "Ghost", contactPhone: null }))
        .resolves.toBe("not_found");
      await expect(tenantRow(tenantA.tenantId)).resolves.toEqual(beforeA);
      await expect(tenantRow(tenantB.tenantId)).resolves.toEqual(beforeB);
    });
  });

  describe("platform tenant status repository", () => {
    it("sets INACTIVE for one tenant only and can reactivate it", async () => {
      const repository = createPrismaPlatformTenantRepository(platformClient());
      try {
        await expect(repository.setStatus(tenantA.tenantId, "INACTIVE")).resolves.toBe("updated");
        await expect(tenantRow(tenantA.tenantId)).resolves.toMatchObject({ status: "INACTIVE" });
        await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ status: "ACTIVE" });

        const listed = (await repository.list()).filter((t) => t.id === tenantA.tenantId || t.id === tenantB.tenantId);
        expect(listed.map(({ id, status }) => ({ id, status })).sort((x, y) => x.id.localeCompare(y.id))).toEqual(
          [
            { id: tenantA.tenantId, status: "INACTIVE" },
            { id: tenantB.tenantId, status: "ACTIVE" },
          ].sort((x, y) => x.id.localeCompare(y.id)),
        );

        await expect(repository.setStatus(tenantA.tenantId, "ACTIVE")).resolves.toBe("updated");
        await expect(tenantRow(tenantA.tenantId)).resolves.toMatchObject({ status: "ACTIVE" });
      } finally {
        await setStatusRaw(tenantA.tenantId, "ACTIVE");
      }
    });

    it("returns not_found for an unknown tenant id without changing others", async () => {
      const repository = createPrismaPlatformTenantRepository(platformClient());
      await expect(repository.setStatus(`tenant-settings-missing-${randomUUID()}`, "INACTIVE")).resolves.toBe("not_found");
      await expect(tenantRow(tenantA.tenantId)).resolves.toMatchObject({ status: "ACTIVE" });
      await expect(tenantRow(tenantB.tenantId)).resolves.toMatchObject({ status: "ACTIVE" });
    });
  });

  describe("inactive gates", () => {
    it("public availability: inactive tenant gets tenant_inactive (distinct from invalid_resource); Tenant B still ok", async () => {
      const repository = createPrismaPublicAvailabilityRepository(client());
      await withTenantAInactive(async () => {
        await expect(repository.read({ tenantId: tenantA.tenantId as never }, {
          serviceId: tenantA.serviceId, staffId: tenantA.staffId, dateIso: bookingDate,
        })).resolves.toEqual({ status: "tenant_inactive" });
        await expect(repository.read({ tenantId: tenantB.tenantId as never }, {
          serviceId: tenantB.serviceId, staffId: tenantB.staffId, dateIso: bookingDate,
        })).resolves.toMatchObject({ status: "ok", serviceActive: true, staffActive: true });
      });
      await expect(repository.read({ tenantId: tenantA.tenantId as never }, {
        serviceId: tenantA.serviceId, staffId: tenantA.staffId, dateIso: bookingDate,
      })).resolves.toMatchObject({ status: "ok" });
    });

    it("booking engine (admin/staff): inactive tenant gets tenant_inactive and nothing is inserted; Tenant B still books", async () => {
      const repository = createPrismaBookingRepository(client());
      const startAt = localWallTimeToUtc(bookingDate, 10 * 60, "Europe/Istanbul");
      const endAt = new Date(startAt.getTime() + 30 * 60_000);
      const input = (fixture: Fixture) => ({
        staffId: fixture.staffId, serviceId: fixture.serviceId, customerProfileId: fixture.customerProfileId, startAt, endAt,
      });

      await withTenantAInactive(async () => {
        const beforeA = await appointmentCount(tenantA.tenantId);
        await expect(repository.createAppointment({ tenantId: tenantA.tenantId as never }, input(tenantA))).resolves.toBe("tenant_inactive");
        await expect(appointmentCount(tenantA.tenantId)).resolves.toBe(beforeA);

        const beforeB = await appointmentCount(tenantB.tenantId);
        await expect(repository.createAppointment({ tenantId: tenantB.tenantId as never }, input(tenantB))).resolves.toBe("created");
        await expect(appointmentCount(tenantB.tenantId)).resolves.toBe(beforeB + 1);
      });

      // Reactivated tenant books again (status gate is not sticky).
      const beforeA = await appointmentCount(tenantA.tenantId);
      await expect(repository.createAppointment({ tenantId: tenantA.tenantId as never }, input(tenantA))).resolves.toBe("created");
      await expect(appointmentCount(tenantA.tenantId)).resolves.toBe(beforeA + 1);
    });
  });
});
