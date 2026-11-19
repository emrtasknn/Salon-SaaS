import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { generateCalendarFeedToken } from "../domain/calendar-feed";
import { createPrismaCalendarFeedRepository } from "./prisma-calendar-feed";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// ADR-045: two-tenant integration test for "CalendarFeedToken" (ENABLE+FORCE RLS, composite FK,
// hash CHECK, one active token per profile+scope) and the feed repository reads.
// CI only (isolated PostgreSQL); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TABLE = "CalendarFeedToken";

type Fixture = Readonly<{
  tenantId: string;
  adminProfileId: string;
  staffProfileId: string;
  inactiveProfileId: string;
  customerProfileId: string;
  staffId: string;
  inactiveStaffId: string;
  serviceId: string;
}>;

function makeFixture(label: string): Fixture {
  const s = `${label}-${randomUUID()}`;
  return {
    tenantId: `feed-${s}`,
    adminProfileId: `feed-admin-${s}`,
    staffProfileId: `feed-staff-${s}`,
    inactiveProfileId: `feed-inactive-${s}`,
    customerProfileId: `feed-customer-${s}`,
    staffId: `feed-staffrow-${s}`,
    inactiveStaffId: `feed-inactiverow-${s}`,
    serviceId: `feed-service-${s}`,
  };
}

describeDatabase("CalendarFeedToken tenant isolation + feed repository integration (ADR-045)", () => {
  const role = `feed_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  const repository = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return createPrismaCalendarFeedRepository(prisma as unknown as PrismaTenantClient);
  };
  const ctx = (fixture: Fixture) => ({ tenantId: fixture.tenantId as never });

  const inRolledBackTx = async <T>(tenantId: string | null, operation: (c: PoolClient) => Promise<T>): Promise<T> => {
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE "${role}"`);
      if (tenantId) await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await operation(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.query("RESET ROLE").catch(() => undefined);
      c.release();
    }
  };

  const insertSql = `INSERT INTO "${TABLE}" ("id", "tenantId", "profileId", "scope", "tokenHash") VALUES ($1, $2, $3, $4::"CalendarFeedScope", $5)`;

  const seedTenant = async (f: Fixture, label: string) => {
    const p = db();
    await p.query(`INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt") VALUES ($1, $1, $2, 'Europe/Istanbul', now(), now())`, [f.tenantId, `Feed Salon ${label}`]);
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $5, 'Admin', now(), now()), ($2, $5, 'Elif', now(), now()), ($3, $5, 'Pasif', now(), now()), ($4, $5, 'Ayşe Müşteri', now(), now())`,
      [f.adminProfileId, f.staffProfileId, f.inactiveProfileId, f.customerProfileId, f.tenantId],
    );
    await p.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1 || '-m', $4, $1 || '-s', $1, 'TENANT_ADMIN', now(), now()),
              ($2 || '-m', $4, $2 || '-s', $2, 'STAFF', now(), now()),
              ($3 || '-m', $4, $3 || '-s', $3, 'STAFF', now(), now())`,
      [f.adminProfileId, f.staffProfileId, f.inactiveProfileId, f.tenantId],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $5, $2, 'ACTIVE', now(), now()), ($3, $5, $4, 'INACTIVE', now(), now())`,
      [f.staffId, f.staffProfileId, f.inactiveStaffId, f.inactiveProfileId, f.tenantId],
    );
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt") VALUES ($1, $2, 'Saç kesimi', 30, 0, true, now(), now())`,
      [f.serviceId, f.tenantId],
    );
    const appointment = (id: string, status: string, startsIn: string) =>
      p.query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6::"AppointmentStatus", now() + $7::interval, now() + $7::interval + interval '30 minutes', now(), now())`,
        [id, f.tenantId, f.staffId, f.serviceId, f.customerProfileId, status, startsIn],
      );
    await appointment(`${f.tenantId}-live`, "CONFIRMED", "1 day");
    await appointment(`${f.tenantId}-pending`, "PENDING", "2 days");
    await appointment(`${f.tenantId}-cancelled`, "CANCELLED", "3 days");
    await appointment(`${f.tenantId}-far`, "CONFIRMED", "400 days");
  };

  const cleanupTenant = async (f: Fixture) => {
    const p = db();
    await p.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [f.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "TenantMembership" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [f.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
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
    try {
      await cleanupTenant(tenantA);
      await cleanupTenant(tenantB);
      if (roleCreated) {
        await pool.query(`REVOKE ALL ON "${TABLE}" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      }
    } finally {
      await prisma?.$disconnect();
      await pool.end();
    }
  });

  it("has RLS enabled and forced", async () => {
    const result = await db().query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`, [TABLE]);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("hides other tenants' tokens and refuses cross-tenant inserts", async () => {
    const a = generateCalendarFeedToken();
    await repository().replace(ctx(tenantA), { profileId: tenantA.staffProfileId, scope: "STAFF_SELF", tokenHash: a.tokenHash, now: new Date() });
    const visible = await inRolledBackTx(tenantB.tenantId, (c) => c.query(`SELECT "id" FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId]));
    expect(visible.rows).toHaveLength(0);
    const none = await inRolledBackTx(null, (c) => c.query(`SELECT "id" FROM "${TABLE}"`));
    expect(none.rows).toHaveLength(0);
    await expect(
      inRolledBackTx(tenantB.tenantId, (c) => c.query(insertSql, [randomUUID(), tenantA.tenantId, tenantA.staffProfileId, "STAFF_SELF", generateCalendarFeedToken().tokenHash])),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await repository().findActiveByHash(ctx(tenantB), a.tokenHash)).toBeNull();
    expect((await repository().findActiveByHash(ctx(tenantA), a.tokenHash))?.profileId).toBe(tenantA.staffProfileId);
  });

  it("rejects a raw token, a cross-tenant profile and a second active token", async () => {
    await expect(
      inRolledBackTx(tenantA.tenantId, (c) => c.query(insertSql, [randomUUID(), tenantA.tenantId, tenantA.staffProfileId, "TENANT_ALL", "not-a-hash"])),
    ).rejects.toMatchObject({ code: "23514", constraint: "CalendarFeedToken_tokenHash_sha256_check" });
    await expect(
      inRolledBackTx(tenantA.tenantId, (c) => c.query(insertSql, [randomUUID(), tenantA.tenantId, tenantB.staffProfileId, "TENANT_ALL", generateCalendarFeedToken().tokenHash])),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inRolledBackTx(tenantA.tenantId, async (c) => {
        await c.query(insertSql, [randomUUID(), tenantA.tenantId, tenantA.adminProfileId, "TENANT_ALL", generateCalendarFeedToken().tokenHash]);
        await c.query(insertSql, [randomUUID(), tenantA.tenantId, tenantA.adminProfileId, "TENANT_ALL", generateCalendarFeedToken().tokenHash]);
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("replaces and revokes: the old link stops working, status follows", async () => {
    const first = generateCalendarFeedToken();
    const second = generateCalendarFeedToken();
    const input = { profileId: tenantA.adminProfileId, scope: "TENANT_ALL" as const, now: new Date() };
    await repository().replace(ctx(tenantA), { ...input, tokenHash: first.tokenHash });
    await repository().replace(ctx(tenantA), { ...input, tokenHash: second.tokenHash });
    expect(await repository().findActiveByHash(ctx(tenantA), first.tokenHash)).toBeNull();
    expect(await repository().findActiveByHash(ctx(tenantA), second.tokenHash)).not.toBeNull();
    expect((await repository().status(ctx(tenantA), input)).active).toBe(true);
    await repository().revoke(ctx(tenantA), input);
    expect(await repository().findActiveByHash(ctx(tenantA), second.tokenHash)).toBeNull();
    expect((await repository().status(ctx(tenantA), input)).active).toBe(false);
  });

  it("reads the holder's current role and staff state", async () => {
    expect(await repository().readHolder(ctx(tenantA), tenantA.staffProfileId)).toEqual({ role: "STAFF", staffId: tenantA.staffId, staffActive: true });
    expect(await repository().readHolder(ctx(tenantA), tenantA.inactiveProfileId)).toMatchObject({ staffActive: false });
    expect(await repository().readHolder(ctx(tenantA), tenantA.adminProfileId)).toEqual({ role: "TENANT_ADMIN", staffId: null, staffActive: false });
    expect(await repository().readHolder(ctx(tenantB), tenantA.staffProfileId)).toEqual({ role: null, staffId: null, staffActive: false });
  });

  it("lists live appointments in the window with names, only of the tenant (and staff) asked for", async () => {
    const now = new Date();
    const window = { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 180 * 86_400_000) };
    const own = await repository().listAppointments(ctx(tenantA), { staffId: tenantA.staffId, ...window });
    expect(own.map((a) => a.id).sort()).toEqual([`${tenantA.tenantId}-live`, `${tenantA.tenantId}-pending`]);
    expect(own[0]).toMatchObject({ customerName: "Ayşe Müşteri", serviceLabel: "Saç kesimi", staffName: "Elif" });
    expect(await repository().listAppointments(ctx(tenantA), { staffId: tenantB.staffId, ...window })).toEqual([]);
    const all = await repository().listAppointments(ctx(tenantA), { staffId: null, ...window });
    expect(all.every((a) => a.id.startsWith(tenantA.tenantId))).toBe(true);
  });
});
