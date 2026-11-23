import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { encryptSecret } from "../infrastructure/calendar-token-crypto";
import { createPrismaCalendarSyncRepository } from "./prisma-calendar-sync";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import { listTrustedBusyBlocks } from "./prisma-external-busy";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// ADR-045 phase B: RLS on CalendarConnection / ExternalBusyBlock / CalendarEventLink, one live
// connection per profile, busy blocks trusted only from fresh live connections, and online
// availability reading them. CI only; skipped without DATABASE_URL. Never against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const TABLES = ["CalendarConnection", "ExternalBusyBlock", "CalendarEventLink"] as const;
const key = randomBytes(32);

type Fixture = Readonly<{ tenantId: string; profileId: string; staffId: string; customerId: string; serviceId: string }>;
const makeFixture = (label: string): Fixture => {
  const s = `${label}-${randomUUID()}`;
  return { tenantId: `gcal-${s}`, profileId: `gcal-p-${s}`, staffId: `gcal-s-${s}`, customerId: `gcal-c-${s}`, serviceId: `gcal-sv-${s}` };
};

/** Next Monday (tenant-local date) so the slot list is in the future. */
function nextMonday(): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (7 - day) + 7));
  return monday.toISOString().slice(0, 10);
}

describeDatabase("Google calendar sync tables integration (ADR-045 phase B)", () => {
  const role = `gcal_test_runner_${randomUUID().replaceAll("-", "")}`;
  const a = makeFixture("a");
  const b = makeFixture("b");
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;
  const db = () => pool!;
  const client = () => prisma as unknown as PrismaTenantClient;
  const repo = () => createPrismaCalendarSyncRepository(client());
  const ctx = (f: Fixture) => ({ tenantId: f.tenantId as never });

  const asRole = async <T>(tenantId: string | null, operation: (c: PoolClient) => Promise<T>) => {
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

  const seed = async (f: Fixture) => {
    const p = db();
    await p.query(`INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt") VALUES ($1, $1, 'Salon', 'Europe/Istanbul', now(), now())`, [f.tenantId]);
    await p.query(`INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $3, 'Elif', now(), now()), ($2, $3, 'Müşteri', now(), now())`, [f.profileId, f.customerId, f.tenantId]);
    await p.query(`INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt") VALUES ($1 || '-m', $2, $1 || '-s', $1, 'STAFF', now(), now())`, [f.profileId, f.tenantId]);
    await p.query(`INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`, [f.staffId, f.tenantId, f.profileId]);
    await p.query(`INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt") VALUES ($1, $2, 'Kesim', 30, 0, true, now(), now())`, [f.serviceId, f.tenantId]);
    await p.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt") SELECT $1 || '-wh-' || d, $1, d, 600, 720, now(), now() FROM generate_series(0, 6) d`,
      [f.tenantId],
    );
  };
  const cleanup = async (f: Fixture) => {
    const p = db();
    for (const table of ["CalendarEventLink", "ExternalBusyBlock", "CalendarConnection", "Appointment", "WorkingHours", "Service", "Staff", "TenantMembership", "Profile"]) {
      await p.query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [f.tenantId]);
    }
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
    for (const table of TABLES) await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO "${role}"`);
    await seed(a);
    await seed(b);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await cleanup(a);
      await cleanup(b);
      if (roleCreated) {
        for (const table of TABLES) await pool.query(`REVOKE ALL ON "${table}" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      }
    } finally {
      await prisma?.$disconnect();
      await pool.end();
    }
  });

  it("has RLS enabled and forced on every new table", async () => {
    const result = await db().query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)`, [[...TABLES]]);
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("stores one live encrypted connection per profile and hides it from other tenants", async () => {
    await repo().create(ctx(a), { profileId: a.profileId, refreshTokenEnc: encryptSecret("r1", key), calendarId: "cal-1", accountEmail: "a@example.com" });
    await repo().create(ctx(a), { profileId: a.profileId, refreshTokenEnc: encryptSecret("r2", key), calendarId: "cal-2", accountEmail: "a@example.com" });
    expect((await repo().findLive(ctx(a), a.profileId))?.calendarId).toBe("cal-2");
    expect(await repo().findLive(ctx(b), a.profileId)).toBeNull();
    const visible = await asRole(b.tenantId, (c) => c.query(`SELECT "id" FROM "CalendarConnection" WHERE "tenantId" = $1`, [a.tenantId]));
    expect(visible.rows).toHaveLength(0);
    await expect(
      asRole(a.tenantId, (c) => c.query(`INSERT INTO "CalendarConnection" ("id", "tenantId", "profileId", "provider", "refreshTokenEnc", "calendarId", "updatedAt") VALUES ($1, $2, $3, 'GOOGLE', 'plain-token', 'x', now())`, [randomUUID(), a.tenantId, a.profileId])),
    ).rejects.toMatchObject({ code: "23514", constraint: "CalendarConnection_refreshTokenEnc_format_check" });
    await expect(
      asRole(b.tenantId, (c) => c.query(`INSERT INTO "ExternalBusyBlock" ("id", "tenantId", "staffId", "connectionId", "startAt", "endAt") VALUES ($1, $2, $3, 'x', now(), now() + interval '1 hour')`, [randomUUID(), a.tenantId, a.staffId])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("closes busy Google time to online booking only while the connection is fresh", async () => {
    const connection = (await repo().findLive(ctx(a), a.profileId))!;
    const date = nextMonday();
    // 11:00–11:30 Istanbul = 08:00–08:30 UTC.
    const busyStart = new Date(`${date}T08:00:00.000Z`);
    const busyEnd = new Date(`${date}T08:30:00.000Z`);
    await repo().replaceBusy(ctx(a), { connectionId: connection.id, staffId: a.staffId, from: new Date(), to: new Date(Date.now() + 30 * 86_400_000), blocks: [{ startAt: busyStart, endAt: busyEnd }] });

    const read = () => createPrismaPublicAvailabilityRepository(client()).read(ctx(a), { serviceId: a.serviceId, staffId: a.staffId, dateIso: date });
    // Never synced → not trusted yet.
    let result = await read();
    expect(result.status === "ok" && result.busyIntervals).toEqual([]);
    await repo().markSynced(ctx(a), connection.id, { now: new Date(), errorCode: null, status: "ACTIVE" });
    result = await read();
    expect(result.status === "ok" && result.busyIntervals?.map((i) => i.startAt.toISOString())).toEqual([busyStart.toISOString()]);
    // Calendar screens: admin (all staff) and staff (own) see the block; another tenant does not.
    const listed = await listTrustedBusyBlocks(client(), ctx(a), { staffId: null, from: new Date(0), to: new Date(8.64e15), now: new Date() });
    expect(listed.map((b) => b.staffId)).toEqual([a.staffId]);
    expect(await listTrustedBusyBlocks(client(), ctx(b), { staffId: null, from: new Date(0), to: new Date(8.64e15), now: new Date() })).toEqual([]);
    // Another tenant's staff sees nothing; revoking drops the blocks at once.
    expect(await repo().busyForStaff(ctx(b), { staffId: a.staffId, from: new Date(0), to: new Date(8.64e15), trustedSince: new Date(0) })).toEqual([]);
    await repo().revoke(ctx(a), connection.id, new Date());
    result = await read();
    expect(result.status === "ok" && result.busyIntervals).toEqual([]);
  });

  it("keeps event links per connection and appointment", async () => {
    await repo().create(ctx(a), { profileId: a.profileId, refreshTokenEnc: encryptSecret("r3", key), calendarId: "cal-3", accountEmail: null });
    const connection = (await repo().findLive(ctx(a), a.profileId))!;
    const appointmentId = `${a.tenantId}-appt`;
    await db().query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', now() + interval '1 day', now() + interval '1 day 30 minutes', now(), now())`,
      [appointmentId, a.tenantId, a.staffId, a.serviceId, a.customerId],
    );
    const window = { from: new Date(), to: new Date(Date.now() + 10 * 86_400_000) };
    await repo().saveLink(ctx(a), connection.id, { appointmentId, externalEventId: "ev-1", syncedUpdatedAt: new Date(0) });
    await repo().saveLink(ctx(a), connection.id, { appointmentId, externalEventId: "ev-2", syncedUpdatedAt: new Date(1000) });
    expect(await repo().listLinks(ctx(a), connection.id, window)).toEqual([{ appointmentId, externalEventId: "ev-2", syncedUpdatedAt: new Date(1000) }]);
    expect(await repo().listLinks(ctx(b), connection.id, window)).toEqual([]);
    await repo().deleteLink(ctx(a), connection.id, appointmentId);
    expect(await repo().listLinks(ctx(a), connection.id, window)).toEqual([]);
  });
});
