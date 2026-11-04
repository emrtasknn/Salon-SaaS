import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createCustomerAppointmentStatus } from "../application/customer-appointment-status";
import { createNoopStatusLinkRateLimiter } from "../application/status-link-rate-limit";
import { localWallTimeToUtc } from "../domain/availability";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import { createPrismaAppointmentAccessTokenRepository } from "./prisma-appointment-access-token";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// WP-06: two-tenant integration test for "AppointmentAccessToken" (RLS, constraints, booking
// write path, customer view/cancel). CI only (isolated PostgreSQL); skipped without DATABASE_URL.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

// Timestamp columns are `timestamp(3)` holding UTC (Prisma convention); build values in SQL.
const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const TABLE = "AppointmentAccessToken";

type TenantFixture = {
  tenantId: string;
  slug: string;
  customerProfileId: string;
  staffProfileId: string;
  staffId: string;
  bookingStaffProfileId: string;
  bookingStaffId: string;
  serviceId: string;
  workingHoursId: string;
};

type SeededAppointment = { appointmentId: string; tokenId: string; token: string; tokenHash: string };

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
    tenantId: `access-token-${label}-${suffix}`,
    slug: `access-token-${label}-${suffix}`,
    customerProfileId: `access-token-customer-${label}-${suffix}`,
    staffProfileId: `access-token-staff-profile-${label}-${suffix}`,
    staffId: `access-token-staff-${label}-${suffix}`,
    bookingStaffProfileId: `access-token-booking-staff-profile-${label}-${suffix}`,
    bookingStaffId: `access-token-booking-staff-${label}-${suffix}`,
    serviceId: `access-token-service-${label}-${suffix}`,
    workingHoursId: `access-token-hours-${label}-${suffix}`,
  };
}

describeDatabase("AppointmentAccessToken tenant isolation integration", () => {
  const role = `access_token_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;

  // Tenant A appointments (one token each; one-token-per-appointment unique).
  let aMain: SeededAppointment;
  let aCancel: SeededAppointment;
  let aExpired: SeededAppointment;
  let aRevoked: SeededAppointment;
  let aCutoff: SeededAppointment;
  let aRaceService: SeededAppointment;
  let aRaceRepository: SeededAppointment;
  let aNoTokenId: string;
  // Tenant B
  let bMain: SeededAppointment;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  const client = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaTenantClient;
  };

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
    code: string,
  ) => {
    await expect(inRolledBackTx(options, (c) => c.query(sql, params))).rejects.toMatchObject({ code });
  };

  const insertTokenSql =
    `INSERT INTO "${TABLE}" ("id", "tenantId", "appointmentId", "tokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, ${NOW_UTC} + interval '7 days', now())`;

  const seedTenant = async (fixture: TenantFixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Access Token Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now()), ($6, $2, $7, now(), now())`,
      [
        fixture.customerProfileId, fixture.tenantId, `Customer ${label}`,
        fixture.staffProfileId, `Staff ${label}`,
        fixture.bookingStaffProfileId, `Booking Staff ${label}`,
      ],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now()), ($4, $2, $5, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId, fixture.bookingStaffId, fixture.bookingStaffProfileId],
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

  /** Seeds an appointment (on `staffId`, never on the booking staff) and optionally its token. */
  const seedAppointment = async (
    fixture: TenantFixture,
    options: Readonly<{
      status: "PENDING" | "CONFIRMED";
      startsIn: string;
      token?: "valid" | "expired" | "revoked" | "none";
    }>,
  ): Promise<SeededAppointment> => {
    const p = db();
    const appointmentId = `access-token-appointment-${randomUUID()}`;
    await p.query(
      `INSERT INTO "Appointment"
        ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6::"AppointmentStatus",
               ${NOW_UTC} + $7::interval, ${NOW_UTC} + $7::interval + interval '30 minutes', now(), now())`,
      [appointmentId, fixture.tenantId, fixture.staffId, fixture.serviceId, fixture.customerProfileId, options.status, options.startsIn],
    );
    const { token, tokenHash } = generateAppointmentAccessToken();
    const tokenId = `access-token-${randomUUID()}`;
    const kind = options.token ?? "valid";
    if (kind !== "none") {
      await p.query(
        `INSERT INTO "${TABLE}" ("id", "tenantId", "appointmentId", "tokenHash", "expiresAt", "revokedAt", "createdAt")
         VALUES ($1, $2, $3, $4,
                 CASE WHEN $5 = 'expired' THEN ${NOW_UTC} - interval '1 minute' ELSE ${NOW_UTC} + interval '10 days' END,
                 CASE WHEN $5 = 'revoked' THEN ${NOW_UTC} ELSE NULL END,
                 now())`,
        [tokenId, fixture.tenantId, appointmentId, tokenHash, kind],
      );
    }
    return { appointmentId, tokenId, token, tokenHash };
  };

  const cleanupTenant = async (fixture: TenantFixture) => {
    const p = db();
    // Tokens first: the composite FK to Appointment is ON DELETE RESTRICT.
    await p.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [fixture.tenantId]);
    await p.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  const appointmentStatus = async (appointmentId: string) => {
    const result = await db().query('SELECT "status" FROM "Appointment" WHERE "id" = $1', [appointmentId]);
    return result.rows[0]?.status as string | undefined;
  };

  const tokenRow = async (tokenId: string) => {
    const result = await db().query(
      `SELECT "tenantId", "revokedAt" IS NULL AS "notRevoked" FROM "${TABLE}" WHERE "id" = $1`,
      [tokenId],
    );
    return result.rows[0] as { tenantId: string; notRevoked: boolean } | undefined;
  };

  const statusService = () => {
    const salons = createPrismaPublicSalonRepository(client());
    return createCustomerAppointmentStatus({
      resolveTenantBySlug: (slug) => salons.resolveBySlug(slug),
      repository: createPrismaAppointmentAccessTokenRepository(client()),
      limiter: createNoopStatusLinkRateLimiter(),
    });
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
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" TO "${role}"`);

    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");

    aMain = await seedAppointment(tenantA, { status: "PENDING", startsIn: "2 days" });
    aCancel = await seedAppointment(tenantA, { status: "PENDING", startsIn: "2 days 1 hour" });
    aExpired = await seedAppointment(tenantA, { status: "PENDING", startsIn: "2 days 2 hours", token: "expired" });
    aRevoked = await seedAppointment(tenantA, { status: "PENDING", startsIn: "2 days 3 hours", token: "revoked" });
    aCutoff = await seedAppointment(tenantA, { status: "CONFIRMED", startsIn: "60 minutes" });
    aRaceService = await seedAppointment(tenantA, { status: "CONFIRMED", startsIn: "3 days" });
    aRaceRepository = await seedAppointment(tenantA, { status: "PENDING", startsIn: "3 days 1 hour" });
    aNoTokenId = (await seedAppointment(tenantA, { status: "PENDING", startsIn: "3 days 2 hours", token: "none" })).appointmentId;
    bMain = await seedAppointment(tenantB, { status: "PENDING", startsIn: "2 days" });
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
    it("has RLS enabled and forced, with the four tenant-isolation policies and the hex CHECK", async () => {
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
        { policyname: "appointment_access_token_tenant_isolation_delete", cmd: "DELETE" },
        { policyname: "appointment_access_token_tenant_isolation_insert", cmd: "INSERT" },
        { policyname: "appointment_access_token_tenant_isolation_select", cmd: "SELECT" },
        { policyname: "appointment_access_token_tenant_isolation_update", cmd: "UPDATE" },
      ]);

      const check = await db().query(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`,
        [`"${TABLE}"`],
      );
      expect(check.rows.map((row) => row.conname)).toContain("AppointmentAccessToken_tokenHash_sha256_hex_check");
    });

    it("lets a tenant read its own token by (tenantId, tokenHash)", async () => {
      const rows = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT "id" FROM "${TABLE}" WHERE "tenantId" = $1 AND "tokenHash" = $2`, [tenantA.tenantId, aMain.tokenHash]));
      expect(rows.rows).toEqual([{ id: aMain.tokenId }]);
    });

    it("lets a tenant insert a token for its own appointment", async () => {
      const inserted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(insertTokenSql, [`access-token-${randomUUID()}`, tenantA.tenantId, aNoTokenId, generateAppointmentAccessToken().tokenHash]));
      expect(inserted.rowCount).toBe(1);
    });

    it("hides Tenant A's token from Tenant B, with and without a tenantId filter", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tokenHash" = $1`, [aMain.tokenHash])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" = $1 AND "tokenHash" = $2`, [tenantA.tenantId, aMain.tokenHash])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [aMain.tokenId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0, 0]);
    });

    it("hides Tenant B's token from Tenant A (reciprocal)", async () => {
      const own = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, (c) =>
        c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [bMain.tokenId]));
      const cross = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [bMain.tokenId]));
      expect([own.rowCount, cross.rowCount]).toEqual([1, 0]);
    });

    it("rejects inserting a Tenant A row under Tenant B's context (RLS WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantB.tenantId, asRole: true },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, aNoTokenId, generateAppointmentAccessToken().tokenHash],
        "42501",
      );
    });

    it("blocks cross-tenant UPDATE and DELETE (0 rows) and leaves Tenant A's row unchanged", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`UPDATE "${TABLE}" SET "revokedAt" = ${NOW_UTC} WHERE "id" = $1`, [aMain.tokenId])).rowCount,
        (await c.query(`UPDATE "${TABLE}" SET "expiresAt" = ${NOW_UTC} WHERE "tokenHash" = $1`, [aMain.tokenHash])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "id" = $1`, [aMain.tokenId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0, 0]);
      await expect(tokenRow(aMain.tokenId)).resolves.toEqual({ tenantId: tenantA.tenantId, notRevoked: true });
    });

    it("rejects moving a token to another tenant under the owner's context (WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "tenantId" = $1 WHERE "id" = $2`,
        [tenantB.tenantId, aMain.tokenId],
        "42501",
      );
    });

    it("returns no rows and rejects inserts without a tenant context", async () => {
      const count = await inRolledBackTx({ tenantId: null, asRole: true }, async (c) =>
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" IN ($1, $2)`, [tenantA.tenantId, tenantB.tenantId])).rowCount);
      expect(count).toBe(0);
      await expectPgError(
        { tenantId: null, asRole: true },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, aNoTokenId, generateAppointmentAccessToken().tokenHash],
        "42501",
      );
    });
  });

  describe("constraints", () => {
    it("rejects a token pointing at another tenant's appointment (composite FK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, bMain.appointmentId, generateAppointmentAccessToken().tokenHash],
        "23503",
      );
    });

    it.each([
      ["63 hex chars", "a".repeat(63)],
      ["65 hex chars", "a".repeat(65)],
      ["uppercase hex", "A".repeat(64)],
      ["raw base64url token", generateAppointmentAccessToken().token],
    ])("rejects a tokenHash that is %s (CHECK)", async (_label, tokenHash) => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, aNoTokenId, tokenHash],
        "23514",
      );
    });

    it("rejects a duplicate (tenantId, tokenHash) and a second token for the same appointment", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, aNoTokenId, aMain.tokenHash],
        "23505",
      );
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertTokenSql,
        [`access-token-${randomUUID()}`, tenantA.tenantId, aMain.appointmentId, generateAppointmentAccessToken().tokenHash],
        "23505",
      );
    });

    it("restricts deleting an appointment that still has a token; allows it after the token is gone", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        'DELETE FROM "Appointment" WHERE "id" = $1',
        [aMain.appointmentId],
        "23503",
      );
      const deleted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: false }, async (c) => {
        await c.query(`DELETE FROM "${TABLE}" WHERE "id" = $1`, [aMain.tokenId]);
        return (await c.query('DELETE FROM "Appointment" WHERE "id" = $1', [aMain.appointmentId])).rowCount;
      });
      expect(deleted).toBe(1);
      await expect(appointmentStatus(aMain.appointmentId)).resolves.toBe("PENDING");
    });
  });

  describe("public booking write path", () => {
    const startAt = localWallTimeToUtc(nextMondayIso(), 10 * 60, "Europe/Istanbul");

    it("creates exactly one token with the given hash and expiresAt = endAt + 7 days", async () => {
      const { tokenHash } = generateAppointmentAccessToken();
      const result = await createPrismaPublicBookingRepository(client()).create({ tenantId: tenantA.tenantId as never }, {
        serviceId: tenantA.serviceId, staffId: tenantA.bookingStaffId, startAt,
        displayName: "Token Customer", email: `token-${randomUUID()}@example.test`, phone: null, accessTokenHash: tokenHash,
      });
      if (typeof result !== "object" || result.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(result)}`);

      const tokens = await db().query(
        `SELECT t."tenantId", t."tokenHash", t."revokedAt" IS NULL AS "notRevoked",
                t."expiresAt" = a."endAt" + interval '7 days' AS "expiresSevenDaysAfterEnd"
         FROM "${TABLE}" t JOIN "Appointment" a ON a."tenantId" = t."tenantId" AND a."id" = t."appointmentId"
         WHERE t."appointmentId" = $1`,
        [result.appointmentId],
      );
      expect(tokens.rows).toEqual([{ tenantId: tenantA.tenantId, tokenHash, notRevoked: true, expiresSevenDaysAfterEnd: true }]);
    });

    it("rolls the booking back when the token insert fails (no appointment, customer or token)", async () => {
      const email = `token-rollback-${randomUUID()}@example.test`;
      const result = await createPrismaPublicBookingRepository(client()).create({ tenantId: tenantA.tenantId as never }, {
        serviceId: tenantA.serviceId, staffId: tenantA.bookingStaffId,
        startAt: new Date(startAt.getTime() + 2 * 60 * 60_000),
        displayName: "Rollback Customer", email, phone: null,
        accessTokenHash: "NOT-A-SHA256-HEX", // violates the CHECK inside the booking transaction
      });
      expect(result).toBe("persistence_failure");
      const leftovers = await db().query(
        `SELECT
           (SELECT count(*)::int FROM "Profile" WHERE "tenantId" = $1 AND "email" = $2) AS profiles,
           (SELECT count(*)::int FROM "Appointment" a JOIN "Profile" p ON p."id" = a."customerProfileId"
              WHERE a."tenantId" = $1 AND p."email" = $2) AS appointments,
           (SELECT count(*)::int FROM "${TABLE}" WHERE "tenantId" = $1 AND "tokenHash" = 'NOT-A-SHA256-HEX') AS tokens`,
        [tenantA.tenantId, email],
      );
      expect(leftovers.rows).toEqual([{ profiles: 0, appointments: 0, tokens: 0 }]);
    });
  });

  describe("customer status link (repository + service)", () => {
    it("finds Tenant A's appointment under Tenant A and nothing under Tenant B", async () => {
      const repository = createPrismaAppointmentAccessTokenRepository(client());
      const now = new Date();
      const own = await repository.findDetailsByTokenHash({ tenantId: tenantA.tenantId as never }, aMain.tokenHash, now);
      expect(own).toMatchObject({ appointmentId: aMain.appointmentId, status: "PENDING", serviceName: "Service A", staffName: "Staff A" });
      await expect(repository.findDetailsByTokenHash({ tenantId: tenantB.tenantId as never }, aMain.tokenHash, now)).resolves.toBeNull();
      const crossCancel = await repository.inCancelTransaction({ tenantId: tenantB.tenantId as never }, (tx) => tx.findByTokenHash(aMain.tokenHash, now));
      expect(crossCancel).toBeNull();
    });

    it("returns the view under the owner slug and generic NOT_FOUND under another slug", async () => {
      const service = statusService();
      const view = await service.view(tenantA.slug, aMain.token);
      expect(view).toMatchObject({
        status: "ok",
        appointment: { salonName: "Access Token Salon A", serviceName: "Service A", staffName: "Staff A", status: "PENDING", canCancel: true },
      });
      await expect(service.view(tenantB.slug, aMain.token)).resolves.toEqual({ status: "NOT_FOUND" });
      await expect(service.cancel(tenantB.slug, aMain.token)).resolves.toEqual({ status: "NOT_FOUND" });
      await expect(appointmentStatus(aMain.appointmentId)).resolves.toBe("PENDING");
    });

    it.each([
      ["expired", () => aExpired],
      ["revoked", () => aRevoked],
    ])("returns NOT_FOUND for an %s token in view and cancel without writing", async (_label, pick) => {
      const seeded = pick();
      const service = statusService();
      await expect(service.view(tenantA.slug, seeded.token)).resolves.toEqual({ status: "NOT_FOUND" });
      await expect(service.cancel(tenantA.slug, seeded.token)).resolves.toEqual({ status: "NOT_FOUND" });
      await expect(appointmentStatus(seeded.appointmentId)).resolves.toBe("PENDING");
    });

    it("cancels PENDING -> CANCELLED, is idempotent, and keeps the token usable", async () => {
      const service = statusService();
      await expect(service.cancel(tenantA.slug, aCancel.token)).resolves.toEqual({ status: "CANCELLED" });
      await expect(appointmentStatus(aCancel.appointmentId)).resolves.toBe("CANCELLED");
      await expect(service.cancel(tenantA.slug, aCancel.token)).resolves.toEqual({ status: "ALREADY_CANCELLED" });
      await expect(tokenRow(aCancel.tokenId)).resolves.toEqual({ tenantId: tenantA.tenantId, notRevoked: true });
      await expect(service.view(tenantA.slug, aCancel.token)).resolves.toMatchObject({
        status: "ok", appointment: { status: "CANCELLED", canCancel: false },
      });
    });

    it("refuses to cancel inside the 120-minute cutoff", async () => {
      const service = statusService();
      await expect(service.view(tenantA.slug, aCutoff.token)).resolves.toMatchObject({ status: "ok", appointment: { canCancel: false } });
      await expect(service.cancel(tenantA.slug, aCutoff.token)).resolves.toEqual({ status: "CUTOFF_PASSED" });
      await expect(appointmentStatus(aCutoff.appointmentId)).resolves.toBe("CONFIRMED");
    });

    it("concurrent double-cancel through the service: one CANCELLED, one ALREADY_CANCELLED", async () => {
      const service = statusService();
      const results = await Promise.all([
        service.cancel(tenantA.slug, aRaceService.token),
        service.cancel(tenantA.slug, aRaceService.token),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["ALREADY_CANCELLED", "CANCELLED"]);
      await expect(appointmentStatus(aRaceService.appointmentId)).resolves.toBe("CANCELLED");
    });

    it("concurrent optimistic updates in two transactions change exactly one row", async () => {
      const repository = createPrismaAppointmentAccessTokenRepository(client());
      const attempt = () => repository.inCancelTransaction({ tenantId: tenantA.tenantId as never }, (tx) =>
        tx.updateStatus(aRaceRepository.appointmentId, "PENDING", "CANCELLED"));
      const updated = await Promise.all([attempt(), attempt()]);
      expect(updated.filter(Boolean)).toHaveLength(1);
      await expect(appointmentStatus(aRaceRepository.appointmentId)).resolves.toBe("CANCELLED");
    });

    it("cannot update Tenant A's appointment status from Tenant B's cancel transaction", async () => {
      const repository = createPrismaAppointmentAccessTokenRepository(client());
      const updated = await repository.inCancelTransaction({ tenantId: tenantB.tenantId as never }, (tx) =>
        tx.updateStatus(aMain.appointmentId, "PENDING", "CANCELLED"));
      expect(updated).toBe(false);
      await expect(appointmentStatus(aMain.appointmentId)).resolves.toBe("PENDING");
    });
  });

  describe("inactive tenant (WP-07)", () => {
    it("keeps the status link and self-cancel working while the tenant is INACTIVE", async () => {
      const seeded = await seedAppointment(tenantB, { status: "PENDING", startsIn: "4 days" });
      await db().query(`UPDATE "Tenant" SET "status" = 'INACTIVE' WHERE "id" = $1`, [tenantB.tenantId]);
      try {
        const service = statusService();
        await expect(service.view(tenantB.slug, seeded.token)).resolves.toMatchObject({
          status: "ok", appointment: { salonName: "Access Token Salon B", status: "PENDING", canCancel: true },
        });
        await expect(service.cancel(tenantB.slug, seeded.token)).resolves.toEqual({ status: "CANCELLED" });
        await expect(appointmentStatus(seeded.appointmentId)).resolves.toBe("CANCELLED");
        // Still tenant-scoped: Tenant A's slug never resolves Tenant B's token.
        await expect(service.view(tenantA.slug, seeded.token)).resolves.toEqual({ status: "NOT_FOUND" });
      } finally {
        await db().query(`UPDATE "Tenant" SET "status" = 'ACTIVE' WHERE "id" = $1`, [tenantB.tenantId]);
      }
    });
  });
});
