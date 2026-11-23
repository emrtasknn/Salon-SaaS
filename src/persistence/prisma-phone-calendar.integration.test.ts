import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../domain/caldav-credentials";
import { createPrismaPhoneCalendarRepository } from "./prisma-phone-calendar";
import { listTrustedBusyBlocks, readTrustedBusy, type ExternalBusyReadTransaction } from "./prisma-external-busy";
import { withPrismaTenantContext, type PrismaTenantClient } from "./prisma-tenant-context";

// ADR-045 phase C: RLS on PhoneCalendarAccount / PhoneCalendarEvent, one live account per
// profile, and phone events as busy time (online booking + calendar display) only while the
// account is live. CI only; skipped without DATABASE_URL. Never against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const TABLES = ["PhoneCalendarAccount", "PhoneCalendarEvent"] as const;

type Fixture = Readonly<{ tenantId: string; slug: string; profileId: string; staffId: string }>;
const makeFixture = (label: string): Fixture => {
  const s = `${label}-${randomUUID().slice(0, 8)}`;
  return { tenantId: `pc-${s}`, slug: `pc-${s}`, profileId: `pc-p-${s}`, staffId: `pc-s-${s}` };
};

describeDatabase("phone calendar account integration (ADR-045 phase C)", () => {
  const role = `pc_test_runner_${randomUUID().replaceAll("-", "")}`;
  const a = makeFixture("a");
  const b = makeFixture("b");
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let roleCreated = false;
  const db = () => pool!;
  const client = () => prisma as unknown as PrismaTenantClient;
  const repo = () => createPrismaPhoneCalendarRepository(client());
  const ctx = (f: Fixture) => ({ tenantId: f.tenantId as never });
  const username = (f: Fixture) => `abcd2345.${f.slug}`;

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
    await p.query(`INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt") VALUES ($1, $2, 'Salon', 'Europe/Istanbul', now(), now())`, [f.tenantId, f.slug]);
    await p.query(`INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, 'Elif', now(), now())`, [f.profileId, f.tenantId]);
    await p.query(`INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt") VALUES ($1 || '-m', $2, $1 || '-s', $1, 'STAFF', now(), now())`, [f.profileId, f.tenantId]);
    await p.query(`INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`, [f.staffId, f.tenantId, f.profileId]);
  };
  const cleanup = async (f: Fixture) => {
    for (const table of ["PhoneCalendarEvent", "PhoneCalendarAccount", "Staff", "TenantMembership", "Profile"]) {
      await db().query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [f.tenantId]);
    }
    await db().query('DELETE FROM "Tenant" WHERE "id" = $1', [f.tenantId]);
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

  it("has RLS enabled and forced", async () => {
    const result = await db().query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)`, [[...TABLES]]);
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("keeps one live account per profile, hidden from other tenants, with only a hash stored", async () => {
    await repo().issue(ctx(a), { profileId: a.profileId, username: `zzzz9999.${a.slug}`, passwordHash: hashPassword("x"), now: new Date() });
    await repo().issue(ctx(a), { profileId: a.profileId, username: username(a), passwordHash: hashPassword("y"), now: new Date() });
    expect(await repo().findLiveAccount(ctx(a), `zzzz9999.${a.slug}`)).toBeNull();
    expect((await repo().findLiveAccount(ctx(a), username(a)))?.profileId).toBe(a.profileId);
    expect(await repo().findLiveAccount(ctx(b), username(a))).toBeNull();
    expect((await repo().status(ctx(a), a.profileId)).active).toBe(true);
    const visible = await asRole(b.tenantId, (c) => c.query(`SELECT "id" FROM "PhoneCalendarAccount" WHERE "tenantId" = $1`, [a.tenantId]));
    expect(visible.rows).toHaveLength(0);
    await expect(
      asRole(a.tenantId, (c) => c.query(`INSERT INTO "PhoneCalendarAccount" ("id", "tenantId", "profileId", "username", "passwordHash") VALUES ($1, $2, $3, $4, 'plain')`, [randomUUID(), a.tenantId, a.profileId, `qqqq2222.${a.slug}`])),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      asRole(b.tenantId, (c) => c.query(`INSERT INTO "PhoneCalendarEvent" ("id", "tenantId", "accountId", "href", "uid", "etag", "ics", "startAt", "endAt", "updatedAt") VALUES ($1, $2, 'x', 'x.ics', 'u', 'e', 'i', now(), now() + interval '1 hour', now())`, [randomUUID(), a.tenantId])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("turns phone events into busy time for booking and display while the account is live", async () => {
    const account = (await repo().findLiveAccount(ctx(a), username(a)))!;
    const start = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const base = { accountId: account.id, staffId: a.staffId, uid: "u1", etag: '"e"', ics: "BEGIN:VCALENDAR", startAt: start, endAt: end };
    await repo().saveEvent(ctx(a), { ...base, href: "busy.ics", title: "Özel iş", blocksTime: true });
    await repo().saveEvent(ctx(a), { ...base, href: "allday.ics", title: "Doğum günü", blocksTime: false });
    const window = { from: new Date(start.getTime() - 1000), to: new Date(end.getTime() + 1000) };

    const booking = () =>
      withPrismaTenantContext(client(), ctx(a), (tx: never) =>
        readTrustedBusy(tx as ExternalBusyReadTransaction, { tenantId: a.tenantId, staffId: a.staffId, ...window, now: new Date() }),
      );
    expect(await booking()).toEqual([{ startAt: start, endAt: end }]);
    const display = await listTrustedBusyBlocks(client(), ctx(a), { staffId: null, ...window, now: new Date() });
    expect(display.map((d) => d.title).sort()).toEqual(["Doğum günü", "Özel iş"]);
    expect(await listTrustedBusyBlocks(client(), ctx(b), { staffId: null, ...window, now: new Date() })).toEqual([]);

    expect((await repo().listEvents(ctx(a), account.id)).map((e) => e.href).sort()).toEqual(["allday.ics", "busy.ics"]);
    expect(await repo().deleteEvent(ctx(a), account.id, "allday.ics")).toBe(true);

    await repo().revoke(ctx(a), { profileId: a.profileId, now: new Date() });
    expect(await booking()).toEqual([]);
    expect(await listTrustedBusyBlocks(client(), ctx(a), { staffId: a.staffId, ...window, now: new Date() })).toEqual([]);
  });
});
