import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";
import { createBookingEngine } from "../application/booking-engine";
import { createPublicBooking } from "../application/public-booking";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { TENANT_LEGAL_COLUMNS_SQL, TENANT_LEGAL_VALUES, publicLegalInput } from "../test/legal-fixtures";

// WP-11: concurrent same-slot booking against real PostgreSQL. N parallel creates for one
// staff/slot must yield exactly one appointment; every loser gets the conflict status.
// Covers the public `createPublicBooking` path, the staff/admin `createOnBehalf` path (WP-08),
// a mixed race between both paths and overlapping (not identical) start times.
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TZ = "Europe/Istanbul";
const PARALLEL = 5;

type Fixture = {
  tenantId: string;
  name: string;
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
    tenantId: `race-${label}-${suffix}`,
    name: `Race Salon ${label.toUpperCase()}`,
    slug: `race-${label}-${suffix}`,
    staffProfileId: `race-staff-profile-${label}-${suffix}`,
    customerProfileId: `race-customer-${label}-${suffix}`,
    staffId: `race-staff-${label}-${suffix}`,
    serviceId: `race-service-${label}-${suffix}`,
    workingHoursId: `race-hours-${label}-${suffix}`,
  };
}

describeDatabase("concurrent same-slot booking integration (WP-11)", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const monday = nextMondayIso();
  // A separate future Monday per scenario so scenarios never interfere.
  const publicMonday = addDaysToDateIso(monday, 7);
  const onBehalfMonday = addDaysToDateIso(monday, 14);
  const mixedMonday = addDaysToDateIso(monday, 21);
  const overlapMonday = addDaysToDateIso(monday, 28);
  const crossTenantMonday = addDaysToDateIso(monday, 35);

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
  const ctx = (fixture: Fixture) => ({ tenantId: fixture.tenantId as never });

  const publicBooking = () => createPublicBooking(createPrismaPublicBookingRepository(client()));
  // Admin scope stub: authorization is unit-tested; this test targets the persistence race.
  const onBehalfEngine = () => createBookingEngine({
    repository: createPrismaBookingRepository(client()),
    authorizer: {
      authorize: async () => false,
      authorizeStaffDecision: async () => false,
      resolveCreateScope: async () => ({ kind: "admin" as const }),
    },
  });
  const identity = createAuthenticatedIdentity("race-user", "race-profile");

  const bookPublic = (fixture: Fixture, startAt: Date) => publicBooking().create(ctx(fixture), {
    serviceId: fixture.serviceId, staffId: fixture.staffId, startAt,
    displayName: "Race Guest", email: `race-${randomUUID()}@example.com`, phone: null,
    // WP-10: the notice the form showed (rendered from this tenant's seeded fields).
    ...publicLegalInput(fixture.name),
  });
  const bookOnBehalf = (fixture: Fixture, startAt: Date) => onBehalfEngine().createOnBehalf(identity, ctx(fixture), {
    serviceId: fixture.serviceId, staffId: fixture.staffId, startAt,
    customer: { kind: "existing", profileId: fixture.customerProfileId },
  });

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
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
    );
    // 30 min + 15 min buffer: a booking at 10:00 occupies 10:00-10:45.
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 15, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    // Monday 09:00-18:00 local.
    await p.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [fixture.workingHoursId, fixture.tenantId],
    );
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    await p.query('DELETE FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    // WP-10: both create paths write an AppointmentContact (FK to Appointment is RESTRICT).
    await p.query('DELETE FROM "AppointmentContact" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  /** Appointments (any status) of the fixture's staff on one local day, with their token counts. */
  const appointmentsOn = async (fixture: Fixture, dateIso: string) => {
    const result = await db().query(
      `SELECT a."id", a."status"::text AS "status",
              (SELECT count(*)::int FROM "AppointmentAccessToken" t WHERE t."tenantId" = a."tenantId" AND t."appointmentId" = a."id") AS "tokens",
              (SELECT count(*)::int FROM "AppointmentContact" c WHERE c."tenantId" = a."tenantId" AND c."appointmentId" = a."id") AS "contacts"
       FROM "Appointment" a
       WHERE a."tenantId" = $1 AND a."staffId" = $2
         AND a."startAt" >= ($3::timestamptz AT TIME ZONE 'UTC') AND a."startAt" < ($4::timestamptz AT TIME ZONE 'UTC')
       ORDER BY a."startAt"`,
      // timestamp(3) columns hold UTC; pass ISO strings so the node-pg local-time serialization cannot shift them.
      [fixture.tenantId, fixture.staffId, localWallTimeToUtc(dateIso, 0, TZ).toISOString(), localWallTimeToUtc(addDaysToDateIso(dateIso, 1), 0, TZ).toISOString()],
    );
    return result.rows as Array<{ id: string; status: string; tokens: number; contacts: number }>;
  };

  const winners = (results: ReadonlyArray<{ status: string }>) =>
    results.filter((r) => r.status === "created" || r.status === "CREATED");
  const winnerId = (results: ReadonlyArray<{ status: string }>) => {
    const [winner] = winners(results);
    return winner && "appointmentId" in winner ? winner.appointmentId : undefined;
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    // Room for PARALLEL concurrent transactions plus the engine's pre-reads.
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, max: 20 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
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
    try {
      await prisma?.$disconnect();
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

  it(`public createPublicBooking: ${PARALLEL} parallel creates for one slot -> exactly one created, others SLOT_UNAVAILABLE`, async () => {
    const startAt = localWallTimeToUtc(publicMonday, 10 * 60, TZ);
    const results = await Promise.all(Array.from({ length: PARALLEL }, () => bookPublic(tenantA, startAt)));

    expect(winners(results)).toHaveLength(1);
    expect(results.filter((r) => r.status === "SLOT_UNAVAILABLE")).toHaveLength(PARALLEL - 1);
    const rows = await appointmentsOn(tenantA, publicMonday);
    expect(rows).toEqual([{ id: winnerId(results), status: "PENDING", tokens: 1, contacts: 1 }]);
  });

  it(`staff/admin createOnBehalf: ${PARALLEL} parallel creates for one slot -> exactly one CREATED, others SLOT_UNAVAILABLE`, async () => {
    const startAt = localWallTimeToUtc(onBehalfMonday, 10 * 60, TZ);
    const results = await Promise.all(Array.from({ length: PARALLEL }, () => bookOnBehalf(tenantA, startAt)));

    expect(winners(results)).toHaveLength(1);
    // Persistence "conflict" (lost the advisory-lock race) maps to SLOT_UNAVAILABLE.
    expect(results.filter((r) => r.status === "SLOT_UNAVAILABLE")).toHaveLength(PARALLEL - 1);
    const rows = await appointmentsOn(tenantA, onBehalfMonday);
    expect(rows).toEqual([{ id: winnerId(results), status: "CONFIRMED", tokens: 1, contacts: 1 }]);
  });

  it("mixed race: public and staff/admin creates for the same slot share one lock -> exactly one appointment", async () => {
    const startAt = localWallTimeToUtc(mixedMonday, 11 * 60, TZ);
    const results = await Promise.all([
      bookPublic(tenantA, startAt), bookOnBehalf(tenantA, startAt), bookPublic(tenantA, startAt),
      bookOnBehalf(tenantA, startAt), bookPublic(tenantA, startAt), bookOnBehalf(tenantA, startAt),
    ]);

    expect(winners(results)).toHaveLength(1);
    expect(results.filter((r) => r.status === "SLOT_UNAVAILABLE")).toHaveLength(results.length - 1);
    const rows = await appointmentsOn(tenantA, mixedMonday);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens).toBe(1);
    // WP-10: the winner's contact snapshot is written once, in the winning transaction.
    expect(rows[0].contacts).toBe(1);
  });

  it("overlapping (not identical) start times: 10:00 / 10:15 / 10:30 in parallel -> exactly one wins", async () => {
    // Each occupies 45 min (30 + 15 buffer), so all three pairwise overlap.
    const starts = [10 * 60, 10 * 60 + 15, 10 * 60 + 30].map((minute) => localWallTimeToUtc(overlapMonday, minute, TZ));
    const results = await Promise.all([
      bookPublic(tenantA, starts[0]), bookOnBehalf(tenantA, starts[1]), bookPublic(tenantA, starts[2]),
      bookOnBehalf(tenantA, starts[0]), bookPublic(tenantA, starts[1]), bookOnBehalf(tenantA, starts[2]),
    ]);

    expect(winners(results)).toHaveLength(1);
    expect(results.filter((r) => r.status === "SLOT_UNAVAILABLE")).toHaveLength(results.length - 1);
    await expect(appointmentsOn(tenantA, overlapMonday)).resolves.toHaveLength(1);
  });

  it("the same local slot in two tenants does not contend: each tenant gets exactly one appointment", async () => {
    const startAt = localWallTimeToUtc(crossTenantMonday, 12 * 60, TZ);
    const results = await Promise.all([
      bookPublic(tenantA, startAt), bookPublic(tenantB, startAt),
      bookOnBehalf(tenantA, startAt), bookOnBehalf(tenantB, startAt),
    ]);

    expect(winners(results)).toHaveLength(2);
    const [rowsA, rowsB] = await Promise.all([appointmentsOn(tenantA, crossTenantMonday), appointmentsOn(tenantB, crossTenantMonday)]);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });
});
