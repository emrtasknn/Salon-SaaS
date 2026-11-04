import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import { createPrismaClosureDateRepository } from "./prisma-closure-dates";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// WP-08: two-tenant integration test for "ClosureDate" (RLS, constraints, closure create/delete,
// closure re-check inside the public and on-behalf booking transactions, closure-vs-booking race).
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TABLE = "ClosureDate";
const TZ = "Europe/Istanbul";

type Fixture = {
  tenantId: string;
  slug: string;
  staffProfileId: string;
  otherStaffProfileId: string;
  customerProfileId: string;
  staffId: string;
  otherStaffId: string;
  serviceId: string;
  workingHoursId: string;
  closureId: string;
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
    tenantId: `closure-${label}-${suffix}`,
    slug: `closure-${label}-${suffix}`,
    staffProfileId: `closure-staff-profile-${label}-${suffix}`,
    otherStaffProfileId: `closure-other-staff-profile-${label}-${suffix}`,
    customerProfileId: `closure-customer-${label}-${suffix}`,
    staffId: `closure-staff-${label}-${suffix}`,
    otherStaffId: `closure-other-staff-${label}-${suffix}`,
    serviceId: `closure-service-${label}-${suffix}`,
    workingHoursId: `closure-hours-${label}-${suffix}`,
    closureId: `closure-row-${label}-${suffix}`,
  };
}

describeDatabase("ClosureDate tenant isolation + booking re-check integration (WP-08)", () => {
  const role = `closure_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  const monday = nextMondayIso();
  // Distinct dates per scenario so tests do not interfere (all Mondays unless noted).
  const seededDate = addDaysToDateIso(monday, 63); // raw seeded tenant-wide rows (A and B)
  const rlsDate = addDaysToDateIso(monday, 70); // rolled-back raw inserts
  const closedMonday = addDaysToDateIso(monday, 7);
  const bufferMonday = addDaysToDateIso(monday, 21);
  const bufferTuesday = addDaysToDateIso(bufferMonday, 1);
  const impactMonday = addDaysToDateIso(monday, 28);
  const duplicateMonday = addDaysToDateIso(monday, 14);
  const raceMondays = [35, 42, 49, 56].map((days) => addDaysToDateIso(monday, days));

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

  const expectPgError = async (
    options: Readonly<{ tenantId: string | null; asRole: boolean }>,
    sql: string,
    params: unknown[],
    expected: Readonly<{ code: string; constraint?: string }>,
  ) => {
    await expect(inRolledBackTx(options, (c) => c.query(sql, params))).rejects.toMatchObject(expected);
  };

  const insertClosureSql =
    `INSERT INTO "${TABLE}" ("id", "tenantId", "staffId", "date", "reason", "createdByProfileId", "createdAt")
     VALUES ($1, $2, $3, $4::date, $5, NULL, now())`;

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, '${TZ}', now(), now())`,
      [fixture.tenantId, fixture.slug, `Closure Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now()), ($6, $2, $7, now(), now())`,
      [
        fixture.staffProfileId, fixture.tenantId, `Staff ${label}`,
        fixture.otherStaffProfileId, `Other Staff ${label}`,
        fixture.customerProfileId, `Customer ${label}`,
      ],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now()), ($4, $2, $5, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId, fixture.otherStaffId, fixture.otherStaffProfileId],
    );
    // 30 min + 15 min buffer, so a late slot's buffer can cross local midnight.
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 15, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    // Monday 09:00-24:00 local.
    await p.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1440, now(), now())`,
      [fixture.workingHoursId, fixture.tenantId],
    );
    await p.query(insertClosureSql, [fixture.closureId, fixture.tenantId, null, seededDate, `Seeded ${label}`]);
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    // ClosureDate first: its composite FKs to Staff/Profile/Tenant are ON DELETE RESTRICT.
    await p.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [fixture.tenantId]);
    await p.query('DELETE FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  const closureRows = async (tenantId: string, dateIso: string) => {
    const result = await db().query(
      `SELECT "id", "staffId", "reason" FROM "${TABLE}" WHERE "tenantId" = $1 AND "date" = $2::date ORDER BY "id"`,
      [tenantId, dateIso],
    );
    return result.rows as Array<{ id: string; staffId: string | null; reason: string | null }>;
  };

  const appointmentsOn = async (tenantId: string, dateIso: string) => {
    const result = await db().query(
      `SELECT "id", "status"::text AS "status" FROM "Appointment"
       WHERE "tenantId" = $1
         AND "startAt" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "startAt" < ($3::timestamptz AT TIME ZONE 'UTC')
       ORDER BY "startAt"`,
      // timestamp(3) columns hold UTC; pass ISO strings so the node-pg local-time serialization cannot shift them.
      [tenantId, localWallTimeToUtc(dateIso, 0, TZ).toISOString(), localWallTimeToUtc(addDaysToDateIso(dateIso, 1), 0, TZ).toISOString()],
    );
    return result.rows as Array<{ id: string; status: string }>;
  };

  const tokenCount = async (tenantId: string) => {
    const result = await db().query('SELECT count(*)::int AS "count" FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [tenantId]);
    return result.rows[0].count as number;
  };

  const onBehalfInput = (fixture: Fixture, startAt: Date) => ({
    staffId: fixture.staffId, serviceId: fixture.serviceId, startAt,
    customer: { kind: "existing" as const, profileId: fixture.customerProfileId },
    initialStatus: "CONFIRMED" as const, accessTokenHash: generateAppointmentAccessToken().tokenHash,
  });

  const publicInput = (fixture: Fixture, startAt: Date) => ({
    serviceId: fixture.serviceId, staffId: fixture.staffId, startAt,
    displayName: "Public Guest", email: `guest-${randomUUID()}@example.com`, phone: null,
    accessTokenHash: generateAppointmentAccessToken().tokenHash,
  });

  const createClosure = (fixture: Fixture, date: string, confirmExistingAppointments = false) =>
    createPrismaClosureDateRepository(client()).create(ctx(fixture), {
      date, reason: null, createdByProfileId: fixture.staffProfileId, confirmExistingAppointments, now: new Date(),
    });

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    // Non-owner, non-superuser role so RLS is actually evaluated (CI connects as a superuser).
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" TO "${role}"`);

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
        await pool.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" FROM "${role}"`);
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
      cleanupErrors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join("\n"));
  });

  describe("schema and RLS", () => {
    it("has RLS enabled and forced, the four tenant-isolation policies and the reason CHECK", async () => {
      const rls = await db().query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1`,
        [TABLE],
      );
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

      const policies = await db().query(
        `SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
        [TABLE],
      );
      expect(policies.rows).toEqual([
        { policyname: "closure_date_tenant_isolation_delete", cmd: "DELETE" },
        { policyname: "closure_date_tenant_isolation_insert", cmd: "INSERT" },
        { policyname: "closure_date_tenant_isolation_select", cmd: "SELECT" },
        { policyname: "closure_date_tenant_isolation_update", cmd: "UPDATE" },
      ]);

      const checks = await db().query(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`,
        [`"${TABLE}"`],
      );
      expect(checks.rows.map((row) => row.conname)).toContain("ClosureDate_reason_not_blank_check");
    });

    it("lets a tenant read and insert its own rows", async () => {
      const own = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT "id" FROM "${TABLE}" WHERE "id" = $1`, [tenantA.closureId]));
      expect(own.rows).toEqual([{ id: tenantA.closureId }]);
      const inserted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(insertClosureSql, [`closure-${randomUUID()}`, tenantA.tenantId, null, rlsDate, null]));
      expect(inserted.rowCount).toBe(1);
    });

    it("hides Tenant A's rows from Tenant B, with and without a tenantId filter (and reciprocally)", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [tenantA.closureId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "date" = $1::date AND "tenantId" <> $2`, [seededDate, tenantB.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0]);
      const reciprocal = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [tenantB.closureId]));
      expect(reciprocal.rowCount).toBe(0);
    });

    it("rejects inserting a Tenant A row under Tenant B's context (RLS WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantB.tenantId, asRole: true },
        insertClosureSql,
        [`closure-${randomUUID()}`, tenantA.tenantId, null, rlsDate, null],
        { code: "42501" },
      );
    });

    it("blocks cross-tenant UPDATE and DELETE (0 rows) and leaves Tenant A's row unchanged", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`UPDATE "${TABLE}" SET "reason" = 'hijack' WHERE "id" = $1`, [tenantA.closureId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "id" = $1`, [tenantA.closureId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0]);
      await expect(closureRows(tenantA.tenantId, seededDate)).resolves.toEqual([{ id: tenantA.closureId, staffId: null, reason: "Seeded A" }]);
    });

    it("rejects moving a row to another tenant under the owner's context (WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "tenantId" = $1 WHERE "id" = $2`,
        [tenantB.tenantId, tenantA.closureId],
        { code: "42501" },
      );
    });

    it("returns no rows and rejects inserts without a tenant context", async () => {
      const count = await inRolledBackTx({ tenantId: null, asRole: true }, async (c) =>
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" IN ($1, $2)`, [tenantA.tenantId, tenantB.tenantId])).rowCount);
      expect(count).toBe(0);
      await expectPgError(
        { tenantId: null, asRole: true },
        insertClosureSql,
        [`closure-${randomUUID()}`, tenantA.tenantId, null, rlsDate, null],
        { code: "42501" },
      );
    });
  });

  describe("constraints", () => {
    it("rejects a per-staff closure pointing at another tenant's staff (composite FK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertClosureSql,
        [`closure-${randomUUID()}`, tenantA.tenantId, tenantB.staffId, rlsDate, null],
        { code: "23503", constraint: "ClosureDate_tenantId_staffId_fkey" },
      );
    });

    it("rejects a creator profile from another tenant (composite FK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        `INSERT INTO "${TABLE}" ("id", "tenantId", "staffId", "date", "createdByProfileId", "createdAt")
         VALUES ($1, $2, NULL, $3::date, $4, now())`,
        [`closure-${randomUUID()}`, tenantA.tenantId, rlsDate, tenantB.staffProfileId],
        { code: "23503", constraint: "ClosureDate_tenantId_createdByProfileId_fkey" },
      );
    });

    it("allows one per-staff closure per staff and date (unique), other staff unaffected", async () => {
      await expect(inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, async (c) => {
        await c.query(insertClosureSql, [`closure-${randomUUID()}`, tenantA.tenantId, tenantA.staffId, rlsDate, null]);
        await c.query(insertClosureSql, [`closure-${randomUUID()}`, tenantA.tenantId, tenantA.otherStaffId, rlsDate, null]);
        return c.query(insertClosureSql, [`closure-${randomUUID()}`, tenantA.tenantId, tenantA.staffId, rlsDate, null]);
      })).rejects.toMatchObject({ code: "23505", constraint: "ClosureDate_tenantId_staffId_date_key" });
    });

    it.each(["", "   ", "\t "])("rejects a blank reason %j via ClosureDate_reason_not_blank_check", async (reason) => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        insertClosureSql,
        [`closure-${randomUUID()}`, tenantA.tenantId, null, rlsDate, reason],
        { code: "23514", constraint: "ClosureDate_reason_not_blank_check" },
      );
    });

    it("rejects a reason longer than 200 characters", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        insertClosureSql,
        [`closure-${randomUUID()}`, tenantA.tenantId, null, rlsDate, "x".repeat(201)],
        { code: "22001" },
      );
    });
  });

  describe("closure repository", () => {
    it("rejects a duplicate tenant-wide closure for the same date (app-enforced)", async () => {
      await expect(createClosure(tenantA, duplicateMonday)).resolves.toMatchObject({ status: "created" });
      await expect(createClosure(tenantA, duplicateMonday)).resolves.toBe("duplicate");
      await expect(closureRows(tenantA.tenantId, duplicateMonday)).resolves.toHaveLength(1);
      // Tenant B may close the same date independently.
      await expect(createClosure(tenantB, duplicateMonday)).resolves.toMatchObject({ status: "created" });
      await expect(closureRows(tenantB.tenantId, duplicateMonday)).resolves.toHaveLength(1);
    });

    it("serializes concurrent tenant-wide creates for one date: exactly one row", async () => {
      const date = addDaysToDateIso(duplicateMonday, 1);
      const results = await Promise.all([createClosure(tenantA, date), createClosure(tenantA, date), createClosure(tenantA, date)]);
      expect(results.filter((r) => typeof r === "object" && r.status === "created")).toHaveLength(1);
      expect(results.filter((r) => r === "duplicate")).toHaveLength(2);
      await expect(closureRows(tenantA.tenantId, date)).resolves.toHaveLength(1);
    });

    it("lists only the context tenant's closures and cannot delete another tenant's closure", async () => {
      const repository = createPrismaClosureDateRepository(client());
      const listedB = await repository.list(ctx(tenantB), { from: seededDate, to: seededDate });
      expect(listedB?.closures.map((c) => c.id)).toEqual([tenantB.closureId]);
      await expect(repository.delete(ctx(tenantB), tenantA.closureId)).resolves.toBe("not_found");
      await expect(closureRows(tenantA.tenantId, seededDate)).resolves.toHaveLength(1);
    });

    it("existing appointments -> has_appointments unless confirmed; confirming never cancels them", async () => {
      const booking = createPrismaBookingRepository(client());
      const publicBooking = createPrismaPublicBookingRepository(client());
      await expect(booking.createAppointment(ctx(tenantA), onBehalfInput(tenantA, localWallTimeToUtc(impactMonday, 10 * 60, TZ))))
        .resolves.toMatchObject({ status: "created" });
      await expect(publicBooking.create(ctx(tenantA), publicInput(tenantA, localWallTimeToUtc(impactMonday, 12 * 60, TZ))))
        .resolves.toMatchObject({ status: "created" });
      const before = await appointmentsOn(tenantA.tenantId, impactMonday);
      expect(before.map((a) => a.status)).toEqual(["CONFIRMED", "PENDING"]);

      const warned = await createClosure(tenantA, impactMonday, false);
      expect(warned).toMatchObject({ status: "has_appointments" });
      if (typeof warned === "object" && warned.status === "has_appointments") {
        expect(warned.appointments.map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
      }
      await expect(closureRows(tenantA.tenantId, impactMonday)).resolves.toEqual([]);

      await expect(createClosure(tenantA, impactMonday, true)).resolves.toMatchObject({ status: "created" });
      await expect(closureRows(tenantA.tenantId, impactMonday)).resolves.toHaveLength(1);
      await expect(appointmentsOn(tenantA.tenantId, impactMonday)).resolves.toEqual(before);
    });

    it("rejects a past local date", async () => {
      await expect(createClosure(tenantA, addDaysToDateIso(monday, -30))).resolves.toBe("past_date");
    });
  });

  describe("closure re-check inside booking transactions (availability bypassed)", () => {
    beforeAll(async () => {
      if (!databaseUrl) return;
      const created = await createClosure(tenantA, closedMonday);
      if (typeof created !== "object" || created.status !== "created") throw new Error("closure fixture was not created");
      const crossing = await createClosure(tenantA, bufferTuesday);
      if (typeof crossing !== "object" || crossing.status !== "created") throw new Error("closure fixture was not created");
    });

    it("public booking on a closed date is rejected in-tx and inserts nothing", async () => {
      const tokensBefore = await tokenCount(tenantA.tenantId);
      await expect(createPrismaPublicBookingRepository(client()).create(ctx(tenantA), publicInput(tenantA, localWallTimeToUtc(closedMonday, 10 * 60, TZ))))
        .resolves.toBe("slot_unavailable");
      await expect(appointmentsOn(tenantA.tenantId, closedMonday)).resolves.toEqual([]);
      await expect(tokenCount(tenantA.tenantId)).resolves.toBe(tokensBefore);
    });

    it("on-behalf (staff/admin) booking on a closed date is rejected in-tx as closed_date", async () => {
      await expect(createPrismaBookingRepository(client()).createAppointment(ctx(tenantA), onBehalfInput(tenantA, localWallTimeToUtc(closedMonday, 11 * 60, TZ))))
        .resolves.toBe("closed_date");
      await expect(appointmentsOn(tenantA.tenantId, closedMonday)).resolves.toEqual([]);
    });

    it("rejects a slot whose buffer crosses local midnight into a closed date; a slot ending at midnight is allowed", async () => {
      // 23:30 + 30 min + 15 min buffer -> 00:15 on the closed Tuesday.
      const crossing = localWallTimeToUtc(bufferMonday, 23 * 60 + 30, TZ);
      await expect(createPrismaBookingRepository(client()).createAppointment(ctx(tenantA), onBehalfInput(tenantA, crossing))).resolves.toBe("closed_date");
      await expect(createPrismaPublicBookingRepository(client()).create(ctx(tenantA), publicInput(tenantA, crossing))).resolves.toBe("slot_unavailable");
      // 23:15 + 45 min -> exactly 00:00 Tuesday: the open Monday is unaffected.
      const endingAtMidnight = localWallTimeToUtc(bufferMonday, 23 * 60 + 15, TZ);
      await expect(createPrismaBookingRepository(client()).createAppointment(ctx(tenantA), onBehalfInput(tenantA, endingAtMidnight)))
        .resolves.toMatchObject({ status: "created" });
      await expect(appointmentsOn(tenantA.tenantId, bufferMonday)).resolves.toHaveLength(1);
    });

    it("availability for the closed date reports the closure for Tenant A only; Tenant B still books that date", async () => {
      const availability = createPrismaPublicAvailabilityRepository(client());
      await expect(availability.read(ctx(tenantA), { serviceId: tenantA.serviceId, staffId: tenantA.staffId, dateIso: closedMonday }))
        .resolves.toMatchObject({ status: "ok", closedDates: [closedMonday] });
      await expect(availability.read(ctx(tenantB), { serviceId: tenantB.serviceId, staffId: tenantB.staffId, dateIso: closedMonday }))
        .resolves.toMatchObject({ status: "ok", closedDates: [] });
      await expect(createPrismaBookingRepository(client()).createAppointment(ctx(tenantB), onBehalfInput(tenantB, localWallTimeToUtc(closedMonday, 10 * 60, TZ))))
        .resolves.toMatchObject({ status: "created" });
      await expect(createPrismaPublicBookingRepository(client()).create(ctx(tenantB), publicInput(tenantB, localWallTimeToUtc(closedMonday, 11 * 60, TZ))))
        .resolves.toMatchObject({ status: "created" });
      await expect(appointmentsOn(tenantB.tenantId, closedMonday)).resolves.toHaveLength(2);
    });

    it("a per-staff closure (raw row; no MVP UI) blocks only that staff member", async () => {
      const date = addDaysToDateIso(closedMonday, 77);
      await db().query(insertClosureSql, [`closure-${randomUUID()}`, tenantA.tenantId, tenantA.staffId, date, null]);
      const booking = createPrismaBookingRepository(client());
      await expect(booking.createAppointment(ctx(tenantA), onBehalfInput(tenantA, localWallTimeToUtc(date, 10 * 60, TZ)))).resolves.toBe("closed_date");
      await expect(booking.createAppointment(ctx(tenantA), { ...onBehalfInput(tenantA, localWallTimeToUtc(date, 10 * 60, TZ)), staffId: tenantA.otherStaffId }))
        .resolves.toMatchObject({ status: "created" });
    });
  });

  describe("closure create vs booking race", () => {
    it.each(raceMondays.map((date, index) => [date, index % 2 === 0 ? "on-behalf" : "public"] as const))(
      "%s (%s booking): exactly one of closure / booking wins, never both and never neither",
      async (date, kind) => {
        const startAt = localWallTimeToUtc(date, 10 * 60, TZ);
        const book = kind === "on-behalf"
          ? createPrismaBookingRepository(client()).createAppointment(ctx(tenantA), onBehalfInput(tenantA, startAt))
          : createPrismaPublicBookingRepository(client()).create(ctx(tenantA), publicInput(tenantA, startAt));
        const [closure, booking] = await Promise.all([createClosure(tenantA, date, false), book]);

        const closureCreated = typeof closure === "object" && closure.status === "created";
        const bookingCreated = typeof booking === "object" && booking.status === "created";
        const closures = await closureRows(tenantA.tenantId, date);
        const appointments = await appointmentsOn(tenantA.tenantId, date);

        expect(closureCreated !== bookingCreated).toBe(true);
        if (closureCreated) {
          expect(booking).toBe(kind === "on-behalf" ? "closed_date" : "slot_unavailable");
          expect(closures).toHaveLength(1);
          expect(appointments).toEqual([]);
        } else {
          expect(closure).toMatchObject({ status: "has_appointments" });
          expect(closures).toEqual([]);
          expect(appointments).toHaveLength(1);
        }
      },
    );
  });
});
