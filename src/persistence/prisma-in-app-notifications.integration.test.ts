import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import {
  PENDING_LIMIT,
  RECENT_LIMIT,
  RECENT_WINDOW_DAYS,
} from "../application/in-app-notifications";
import { createPrismaInAppNotificationRepository } from "./prisma-in-app-notifications";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = {
  tenantId: string;
  slug: string;
  customerId: string;
  staffProfileId: string;
  otherStaffProfileId: string;
  staffId: string;
  otherStaffId: string;
  serviceId: string;
  pendingId: string;
  recentId: string;
  oldId: string;
  otherStaffPendingId: string;
  otherStaffRecentId: string;
};

const fixture = (label: string): Fixture => {
  const suffix = randomUUID();
  return {
    tenantId: `inapp-integration-${label}-${suffix}`,
    slug: `inapp-integration-${label}-${suffix}`,
    customerId: `inapp-customer-${label}-${suffix}`,
    staffProfileId: `inapp-staff-profile-${label}-${suffix}`,
    otherStaffProfileId: `inapp-staff2-profile-${label}-${suffix}`,
    staffId: `inapp-staff-${label}-${suffix}`,
    otherStaffId: `inapp-staff2-${label}-${suffix}`,
    serviceId: `inapp-service-${label}-${suffix}`,
    pendingId: `inapp-pending-${label}-${suffix}`,
    recentId: `inapp-recent-${label}-${suffix}`,
    oldId: `inapp-old-${label}-${suffix}`,
    otherStaffPendingId: `inapp-staff2-pending-${label}-${suffix}`,
    otherStaffRecentId: `inapp-staff2-recent-${label}-${suffix}`,
  };
};

const appointmentIds = (data: Fixture) => [
  data.pendingId,
  data.recentId,
  data.oldId,
  data.otherStaffPendingId,
  data.otherStaffRecentId,
];

const DAY_MS = 24 * 60 * 60 * 1000;

describeDatabase("Prisma in-app notifications integration", () => {
  const tenantA = fixture("a");
  const tenantB = fixture("b");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const seedTenant = async (data: Fixture, label: string) => {
    if (!pool) throw new Error("Database pool was not initialized");

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [data.tenantId, data.slug, `In-app Integration ${label}`],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now()), ($6, $2, $7, now(), now())`,
      [
        data.customerId,
        data.tenantId,
        `Customer ${label}`,
        data.staffProfileId,
        `Staff ${label}`,
        data.otherStaffProfileId,
        `Other Staff ${label}`,
      ],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now()), ($4, $2, $5, 'ACTIVE', now(), now())`,
      [data.staffId, data.tenantId, data.staffProfileId, data.otherStaffId, data.otherStaffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [data.serviceId, data.tenantId, `Service ${label}`],
    );

    // Future, non-overlapping slots. updatedAt is set explicitly so the 7-day window is deterministic.
    const rows: Array<[string, string, string, number, string]> = [
      [data.pendingId, data.staffId, "PENDING", 1, "1 hour"],
      [data.recentId, data.staffId, "CONFIRMED", 2, "1 day"],
      [data.oldId, data.staffId, "COMPLETED", 3, "10 days"],
      [data.otherStaffPendingId, data.otherStaffId, "PENDING", 4, "1 hour"],
      [data.otherStaffRecentId, data.otherStaffId, "CANCELLED", 5, "2 days"],
    ];
    for (const [id, staffId, status, dayOffset, age] of rows) {
      const startAt = new Date(Date.now() + dayOffset * DAY_MS);
      const endAt = new Date(startAt.getTime() + 30 * 60_000);
      await pool.query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6::"AppointmentStatus", $7, $8, now() - interval '30 days', now() - $9::interval)`,
        [id, data.tenantId, staffId, data.serviceId, data.customerId, status, startAt, endAt, age],
      );
    }
  };

  const cleanupTenant = async (data: Fixture) => {
    if (!pool) return;
    await pool.query('DELETE FROM "Appointment" WHERE "id" = ANY($1::text[])', [appointmentIds(data)]);
    await pool.query('DELETE FROM "Staff" WHERE "id" IN ($1, $2)', [data.staffId, data.otherStaffId]);
    await pool.query('DELETE FROM "Service" WHERE "id" = $1', [data.serviceId]);
    await pool.query(
      'DELETE FROM "Profile" WHERE "id" IN ($1, $2, $3)',
      [data.customerId, data.staffProfileId, data.otherStaffProfileId],
    );
    await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [data.tenantId]);
  };

  const readOptions = () => ({
    since: new Date(Date.now() - RECENT_WINDOW_DAYS * DAY_MS),
    pendingLimit: PENDING_LIMIT,
    recentLimit: RECENT_LIMIT,
  });

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
    for (const data of [tenantA, tenantB]) {
      try {
        await cleanupTenant(data);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${data.tenantId}: ${String(error)}`);
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

  it("never returns another tenant's appointments in either direction", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaInAppNotificationRepository(prisma as unknown as PrismaTenantClient);

    const [resultA, resultB] = await Promise.all([
      repository.read({ tenantId: tenantA.tenantId as never }, { kind: "tenant" }, readOptions()),
      repository.read({ tenantId: tenantB.tenantId as never }, { kind: "tenant" }, readOptions()),
    ]);

    expect(resultA.pendingCount).toBe(2);
    expect(resultA.pending.map((item) => item.appointmentId)).toEqual([tenantA.pendingId, tenantA.otherStaffPendingId]);
    expect(resultA.recent.map((item) => item.appointmentId)).toEqual([tenantA.recentId, tenantA.otherStaffRecentId]);
    expect(resultB.pendingCount).toBe(2);
    expect(resultB.pending.map((item) => item.appointmentId)).toEqual([tenantB.pendingId, tenantB.otherStaffPendingId]);
    expect(resultB.recent.map((item) => item.appointmentId)).toEqual([tenantB.recentId, tenantB.otherStaffRecentId]);

    const idsA = [...resultA.pending, ...resultA.recent].map((item) => item.appointmentId);
    const idsB = [...resultB.pending, ...resultB.recent].map((item) => item.appointmentId);
    for (const id of appointmentIds(tenantB)) expect(idsA).not.toContain(id);
    for (const id of appointmentIds(tenantA)) expect(idsB).not.toContain(id);

    expect(resultA.pending[0]).toMatchObject({
      kind: "PENDING_REQUEST",
      status: "PENDING",
      serviceName: "Service A",
      staffDisplayName: "Staff A",
      customerDisplayName: "Customer A",
    });
  });

  it("does not return tenant B rows when tenant A context is used with a tenant B staffId", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaInAppNotificationRepository(prisma as unknown as PrismaTenantClient);

    const result = await repository.read(
      { tenantId: tenantA.tenantId as never },
      { kind: "staff", staffId: tenantB.staffId },
      readOptions(),
    );

    expect(result).toEqual({ pendingCount: 0, pending: [], recent: [] });
  });

  it("limits staff scope to the staff member's own appointments without customer names", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaInAppNotificationRepository(prisma as unknown as PrismaTenantClient);

    const result = await repository.read(
      { tenantId: tenantA.tenantId as never },
      { kind: "staff", staffId: tenantA.staffId },
      readOptions(),
    );

    expect(result.pendingCount).toBe(1);
    expect(result.pending.map((item) => item.appointmentId)).toEqual([tenantA.pendingId]);
    expect(result.recent.map((item) => item.appointmentId)).toEqual([tenantA.recentId]);
    const ids = [...result.pending, ...result.recent].map((item) => item.appointmentId);
    expect(ids).not.toContain(tenantA.otherStaffPendingId);
    expect(ids).not.toContain(tenantA.otherStaffRecentId);
    for (const item of [...result.pending, ...result.recent]) {
      expect(item.staffDisplayName).toBe("Staff A");
      expect(item).not.toHaveProperty("customerDisplayName");
    }
  });

  it("excludes appointments whose updatedAt is older than the recent window", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaInAppNotificationRepository(prisma as unknown as PrismaTenantClient);

    const [tenantResult, staffResult] = await Promise.all([
      repository.read({ tenantId: tenantA.tenantId as never }, { kind: "tenant" }, readOptions()),
      repository.read({ tenantId: tenantA.tenantId as never }, { kind: "staff", staffId: tenantA.staffId }, readOptions()),
    ]);

    expect(tenantResult.recent.map((item) => item.appointmentId)).not.toContain(tenantA.oldId);
    expect(staffResult.recent.map((item) => item.appointmentId)).not.toContain(tenantA.oldId);
    expect(tenantResult.recent.every((item) => item.kind === "STATUS_CHANGED" && item.status !== "PENDING")).toBe(true);
    // Recent is newest first.
    const updated = tenantResult.recent.map((item) => item.updatedAt.getTime());
    expect([...updated].sort((a, b) => b - a)).toEqual(updated);
  });
});
