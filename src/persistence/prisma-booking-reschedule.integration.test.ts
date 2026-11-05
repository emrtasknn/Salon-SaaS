import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";
import type { AppointmentRecord } from "../domain/appointment";
import { createBookingEngine } from "../application/booking-engine";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { TENANT_LEGAL_COLUMNS_SQL, TENANT_LEGAL_VALUES } from "../test/legal-fixtures";

// Owner decision 2026-11-05: drag-to-move (reschedule) against real PostgreSQL.
// Own old slot is not a conflict, another appointment is, concurrent moves into one slot yield one
// winner, a stale expected start and another tenant's id never write.
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const TZ = "Europe/Istanbul";

type Fixture = { tenantId: string; name: string; slug: string; staffProfileId: string; customerProfileId: string; staffId: string; serviceId: string; workingHoursId: string };

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
    tenantId: `move-${label}-${suffix}`, name: `Move Salon ${label.toUpperCase()}`, slug: `move-${label}-${suffix}`,
    staffProfileId: `move-staff-profile-${label}-${suffix}`, customerProfileId: `move-customer-${label}-${suffix}`,
    staffId: `move-staff-${label}-${suffix}`, serviceId: `move-service-${label}-${suffix}`, workingHoursId: `move-hours-${label}-${suffix}`,
  };
}

describeDatabase("appointment reschedule integration", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const monday = addDaysToDateIso(nextMondayIso(), 42);
  const at = (minute: number) => localWallTimeToUtc(monday, minute, TZ);

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  const db = () => { if (!pool) throw new Error("no pool"); return pool; };
  const client = () => { if (!prisma) throw new Error("no prisma"); return prisma as unknown as PrismaTenantClient; };
  const ctx = (fixture: Fixture) => ({ tenantId: fixture.tenantId as never });
  const repository = () => createPrismaBookingRepository(client());
  const engine = () => createBookingEngine({
    repository: repository(),
    // Admin scope stub: authorization is unit-tested; this test targets persistence.
    authorizer: { authorize: async () => false, authorizeStaffDecision: async () => false, resolveCreateScope: async () => ({ kind: "admin" as const }) },
  });
  const identity = createAuthenticatedIdentity("move-user", "move-profile");

  const create = async (fixture: Fixture, startAt: Date) => {
    const result = await engine().createOnBehalf(identity, ctx(fixture), {
      serviceId: fixture.serviceId, staffId: fixture.staffId, startAt, customer: { kind: "existing", profileId: fixture.customerProfileId },
    });
    if (result.status !== "CREATED") throw new Error(`seed booking failed: ${result.status}`);
    return result.appointmentId;
  };
  const record = async (fixture: Fixture, id: string): Promise<AppointmentRecord> => {
    const { rows } = await db().query(
      // timestamp(3) columns hold UTC; read them as ISO text so node-pg local-time parsing cannot shift them.
      `SELECT "id", "tenantId", "staffId", "serviceId", "customerProfileId", "status"::text AS "status",
              to_char("startAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startAt",
              to_char("endAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endAt"
       FROM "Appointment" WHERE "tenantId" = $1 AND "id" = $2`, [fixture.tenantId, id]);
    const row = rows[0];
    return { ...row, startAt: new Date(row.startAt), endAt: new Date(row.endAt) };
  };

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", ${TENANT_LEGAL_COLUMNS_SQL}, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, '${TZ}', $4, $5, $6, now(), now())`,
      [fixture.tenantId, fixture.slug, fixture.name, ...TENANT_LEGAL_VALUES],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now())`,
      [fixture.staffProfileId, fixture.tenantId, `Staff ${label}`, fixture.customerProfileId, `Customer ${label}`],
    );
    await p.query(`INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId]);
    // 30 min + 15 min buffer: an appointment at 10:00 occupies 10:00-10:45.
    await p.query(`INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 15, true, now(), now())`, [fixture.serviceId, fixture.tenantId, `Service ${label}`]);
    await p.query(`INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`, [fixture.workingHoursId, fixture.tenantId]);
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    for (const table of ["AppointmentAccessToken", "NotificationDelivery", "AppointmentContact", "Appointment", "WorkingHours", "Staff", "Service", "Profile"]) {
      await p.query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [fixture.tenantId]);
    }
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, max: 10 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool) return;
    for (const fixture of [tenantA, tenantB]) await cleanupTenant(fixture).catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it("moves into a slot overlapping its own old time and recomputes endAt", async () => {
    const id = await create(tenantA, at(10 * 60));
    const result = await engine().reschedule(identity, ctx(tenantA), await record(tenantA, id), at(10 * 60 + 15));
    expect(result.status).toBe("RESCHEDULED");
    const moved = await record(tenantA, id);
    expect(moved.startAt.getTime()).toBe(at(10 * 60 + 15).getTime());
    expect(moved.endAt.getTime()).toBe(at(11 * 60).getTime());
  });

  it("refuses a slot taken by another appointment", async () => {
    const first = await create(tenantA, at(12 * 60));
    await create(tenantA, at(13 * 60));
    const result = await engine().reschedule(identity, ctx(tenantA), await record(tenantA, first), at(13 * 60));
    expect(result.status).toBe("SLOT_UNAVAILABLE");
    expect((await record(tenantA, first)).startAt.getTime()).toBe(at(12 * 60).getTime());
  });

  it("lets only one of two concurrent moves into the same free slot win", async () => {
    const x = await create(tenantA, at(14 * 60));
    const y = await create(tenantA, at(15 * 60));
    const target = at(16 * 60);
    const results = await Promise.all([
      repository().rescheduleAppointment(ctx(tenantA), { appointmentId: x, staffId: tenantA.staffId, serviceId: tenantA.serviceId, expectedStartAt: at(14 * 60), startAt: target }),
      repository().rescheduleAppointment(ctx(tenantA), { appointmentId: y, staffId: tenantA.staffId, serviceId: tenantA.serviceId, expectedStartAt: at(15 * 60), startAt: target }),
    ]);
    expect(results.filter((r) => typeof r === "object" && r.status === "rescheduled")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(1);
  });

  it("does not write when the expected start is stale", async () => {
    const id = await create(tenantA, at(9 * 60));
    const result = await repository().rescheduleAppointment(ctx(tenantA), {
      appointmentId: id, staffId: tenantA.staffId, serviceId: tenantA.serviceId, expectedStartAt: at(9 * 60 + 15), startAt: at(17 * 60),
    });
    expect(result).toBe("stale");
    expect((await record(tenantA, id)).startAt.getTime()).toBe(at(9 * 60).getTime());
  });

  it("never moves another tenant's appointment", async () => {
    const id = await create(tenantA, at(16 * 60 + 30));
    const result = await repository().rescheduleAppointment(ctx(tenantB), {
      appointmentId: id, staffId: tenantA.staffId, serviceId: tenantA.serviceId, expectedStartAt: at(16 * 60 + 30), startAt: at(17 * 60),
    });
    expect(result === "stale" || result === "invalid_resource").toBe(true);
    expect((await record(tenantA, id)).startAt.getTime()).toBe(at(16 * 60 + 30).getTime());
  });
});
