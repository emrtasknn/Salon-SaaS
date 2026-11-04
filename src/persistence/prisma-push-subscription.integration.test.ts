import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaPushNotificationRepository, createPrismaPushSubscriptionRepository } from "./prisma-push-subscription";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// WP-09: two-tenant integration test for "PushSubscription" (ENABLE+FORCE RLS, composite FK,
// CHECKs, per-tenant endpoint unique, reassignment, unsubscribe, provider-outcome bookkeeping).
// CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TABLE = "PushSubscription";

type Fixture = {
  tenantId: string;
  slug: string;
  adminProfileId: string;
  staffProfileId: string;
  otherStaffProfileId: string;
  inactiveStaffProfileId: string;
  subscriptionId: string;
  endpoint: string;
};

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  return {
    tenantId: `push-${label}-${suffix}`,
    slug: `push-${label}-${suffix}`,
    adminProfileId: `push-admin-${label}-${suffix}`,
    staffProfileId: `push-staff-${label}-${suffix}`,
    otherStaffProfileId: `push-staff2-${label}-${suffix}`,
    inactiveStaffProfileId: `push-inactive-${label}-${suffix}`,
    subscriptionId: `push-sub-${label}-${suffix}`,
    endpoint: `https://push.example.com/seeded-${label}-${suffix}`,
  };
}

/** Real-shaped unpadded base64url keys: 65-byte point (87 chars, leading 0x04 -> "B") and 16 bytes (22 chars). */
function keys(seed = randomUUID()) {
  const material = Buffer.from(seed.repeat(4)).toString("base64url");
  return { p256dh: `B${material.slice(0, 86)}`, auth: material.slice(0, 22) };
}

describeDatabase("PushSubscription tenant isolation + lifecycle integration (WP-09)", () => {
  const role = `push_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");

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

  const insertSql =
    `INSERT INTO "${TABLE}" ("id", "tenantId", "profileId", "endpoint", "p256dh", "auth", "userAgent", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`;

  const insertParams = (
    fixture: Fixture,
    overrides: Partial<{ id: string; profileId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }> = {},
  ) => {
    const k = keys();
    return [
      overrides.id ?? `push-${randomUUID()}`,
      fixture.tenantId,
      overrides.profileId ?? fixture.staffProfileId,
      overrides.endpoint ?? `https://push.example.com/${randomUUID()}`,
      overrides.p256dh ?? k.p256dh,
      overrides.auth ?? k.auth,
      overrides.userAgent ?? null,
    ];
  };

  const rowsFor = async (tenantId: string, endpoint: string) => {
    const result = await db().query(
      `SELECT "id", "profileId", "p256dh", "auth", "failureCount", "revokedAt", "lastSuccessAt", "lastFailureAt"
       FROM "${TABLE}" WHERE "tenantId" = $1 AND "endpoint" = $2`,
      [tenantId, endpoint],
    );
    return result.rows as Array<{
      id: string; profileId: string; p256dh: string; auth: string; failureCount: number;
      revokedAt: Date | null; lastSuccessAt: Date | null; lastFailureAt: Date | null;
    }>;
  };

  const subscribe = (fixture: Fixture, profileId: string, endpoint: string, k = keys()) =>
    createPrismaPushSubscriptionRepository(client()).upsert(ctx(fixture), {
      profileId, endpoint, p256dh: k.p256dh, auth: k.auth, userAgent: "Integration UA", at: new Date(),
    });

  const seedTenant = async (fixture: Fixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Push Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now()), ($6, $2, $7, now(), now()), ($8, $2, $9, now(), now())`,
      [
        fixture.adminProfileId, fixture.tenantId, `Admin ${label}`,
        fixture.staffProfileId, `Staff ${label}`,
        fixture.otherStaffProfileId, `Staff2 ${label}`,
        fixture.inactiveStaffProfileId, `Inactive ${label}`,
      ],
    );
    await p.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'TENANT_ADMIN', now(), now()),
              ($5, $2, $6, $7, 'STAFF', now(), now()),
              ($8, $2, $9, $10, 'STAFF', now(), now()),
              ($11, $2, $12, $13, 'STAFF', now(), now())`,
      [
        `${fixture.adminProfileId}-m`, fixture.tenantId, `${fixture.adminProfileId}-s`, fixture.adminProfileId,
        `${fixture.staffProfileId}-m`, `${fixture.staffProfileId}-s`, fixture.staffProfileId,
        `${fixture.otherStaffProfileId}-m`, `${fixture.otherStaffProfileId}-s`, fixture.otherStaffProfileId,
        `${fixture.inactiveStaffProfileId}-m`, `${fixture.inactiveStaffProfileId}-s`, fixture.inactiveStaffProfileId,
      ],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now()), ($4, $2, $5, 'ACTIVE', now(), now()), ($6, $2, $7, 'INACTIVE', now(), now())`,
      [
        `${fixture.staffProfileId}-staff`, fixture.tenantId, fixture.staffProfileId,
        `${fixture.otherStaffProfileId}-staff`, fixture.otherStaffProfileId,
        `${fixture.inactiveStaffProfileId}-staff`, fixture.inactiveStaffProfileId,
      ],
    );
    await p.query(insertSql, insertParams(fixture, { id: fixture.subscriptionId, endpoint: fixture.endpoint }));
  };

  const cleanupTenant = async (fixture: Fixture) => {
    const p = db();
    // PushSubscription first: its FKs to Profile/Tenant are ON DELETE RESTRICT.
    await p.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "TenantMembership" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
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
    it("has RLS enabled and forced, the four tenant-isolation policies, the CHECKs and the WEB_PUSH enum value", async () => {
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
        { policyname: "push_subscription_tenant_isolation_delete", cmd: "DELETE" },
        { policyname: "push_subscription_tenant_isolation_insert", cmd: "INSERT" },
        { policyname: "push_subscription_tenant_isolation_select", cmd: "SELECT" },
        { policyname: "push_subscription_tenant_isolation_update", cmd: "UPDATE" },
      ]);

      const checks = await db().query(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c' ORDER BY conname`,
        [`"${TABLE}"`],
      );
      expect(checks.rows.map((row) => row.conname)).toEqual([
        "PushSubscription_auth_base64url_check",
        "PushSubscription_endpoint_https_check",
        "PushSubscription_failureCount_nonnegative_check",
        "PushSubscription_p256dh_base64url_check",
        "PushSubscription_userAgent_length_check",
      ]);

      const enumValues = await db().query(`SELECT unnest(enum_range(NULL::"NotificationChannel"))::text AS value`);
      expect(enumValues.rows.map((row) => row.value)).toEqual(expect.arrayContaining(["WHATSAPP", "WEB_PUSH"]));
    });

    it("lets a tenant read and insert its own rows", async () => {
      const own = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT "id" FROM "${TABLE}" WHERE "id" = $1`, [tenantA.subscriptionId]));
      expect(own.rows).toEqual([{ id: tenantA.subscriptionId }]);
      const inserted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(insertSql, insertParams(tenantA)));
      expect(inserted.rowCount).toBe(1);
    });

    it("hides Tenant A's rows from Tenant B by id, endpoint and tenantId (and reciprocally)", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [tenantA.subscriptionId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "endpoint" = $1`, [tenantA.endpoint])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0]);
      const reciprocal = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [tenantB.subscriptionId]));
      expect(reciprocal.rowCount).toBe(0);
    });

    it("rejects inserting a Tenant B row under Tenant A's context (RLS WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        insertSql,
        insertParams(tenantB),
        { code: "42501" },
      );
    });

    it("blocks cross-tenant UPDATE and DELETE (0 rows) and leaves Tenant B's row unchanged", async () => {
      const before = await rowsFor(tenantB.tenantId, tenantB.endpoint);
      const counts = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, async (c) => [
        (await c.query(`UPDATE "${TABLE}" SET "revokedAt" = now() WHERE "id" = $1`, [tenantB.subscriptionId])).rowCount,
        (await c.query(`UPDATE "${TABLE}" SET "profileId" = $1 WHERE "tenantId" = $2`, [tenantA.adminProfileId, tenantB.tenantId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "id" = $1`, [tenantB.subscriptionId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantB.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0, 0]);
      const visibleAsB = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, (c) =>
        c.query(`SELECT "id" FROM "${TABLE}" WHERE "id" = $1`, [tenantB.subscriptionId]));
      expect(visibleAsB.rows).toEqual([{ id: tenantB.subscriptionId }]);
      await expect(rowsFor(tenantB.tenantId, tenantB.endpoint)).resolves.toEqual(before);
    });

    it("rejects moving a row to another tenant under the owner's context (WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "tenantId" = $1 WHERE "id" = $2`,
        [tenantB.tenantId, tenantA.subscriptionId],
        { code: "42501" },
      );
    });

    it("returns no rows and rejects inserts without a tenant context", async () => {
      const count = await inRolledBackTx({ tenantId: null, asRole: true }, async (c) =>
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" IN ($1, $2)`, [tenantA.tenantId, tenantB.tenantId])).rowCount);
      expect(count).toBe(0);
      await expectPgError({ tenantId: null, asRole: true }, insertSql, insertParams(tenantA), { code: "42501" });
    });

    it("send-time lookup with another tenant's context fails closed (0 subscriptions)", async () => {
      const repository = createPrismaPushNotificationRepository(client());
      await expect(repository.activeSubscriptions(ctx(tenantB), tenantA.staffProfileId)).resolves.toEqual([]);
    });
  });

  describe("constraints", () => {
    it("rejects a profile from another tenant (composite FK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: false },
        insertSql,
        insertParams(tenantA, { profileId: tenantB.staffProfileId }),
        { code: "23503", constraint: "PushSubscription_tenantId_profileId_fkey" },
      );
    });

    it("blocks deleting a profile that still has a subscription (RESTRICT)", async () => {
      // A profile referenced only by a PushSubscription, so the violation can only come from that FK.
      const profileId = `push-only-${randomUUID()}`;
      await expect(inRolledBackTx({ tenantId: tenantA.tenantId, asRole: false }, async (c) => {
        await c.query(
          `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, 'Push only', now(), now())`,
          [profileId, tenantA.tenantId],
        );
        await c.query(insertSql, insertParams(tenantA, { profileId }));
        return c.query('DELETE FROM "Profile" WHERE "tenantId" = $1 AND "id" = $2', [tenantA.tenantId, profileId]);
      })).rejects.toMatchObject({ code: "23503", constraint: "PushSubscription_tenantId_profileId_fkey" });
    });

    it.each([
      ["http endpoint", { endpoint: "http://push.example.com/x" }, "PushSubscription_endpoint_https_check"],
      ["2049-char endpoint", { endpoint: `https://push.example.com/${"a".repeat(2049 - "https://push.example.com/".length)}` }, "PushSubscription_endpoint_https_check"],
      ["p256dh 86 chars", { p256dh: `B${"a".repeat(85)}` }, "PushSubscription_p256dh_base64url_check"],
      ["p256dh 88 chars", { p256dh: `B${"a".repeat(87)}` }, "PushSubscription_p256dh_base64url_check"],
      ["p256dh with '='", { p256dh: `B${"a".repeat(85)}=` }, "PushSubscription_p256dh_base64url_check"],
      ["p256dh with '+'", { p256dh: `B${"a".repeat(85)}+` }, "PushSubscription_p256dh_base64url_check"],
      ["auth 21 chars", { auth: "b".repeat(21) }, "PushSubscription_auth_base64url_check"],
      ["auth 23 chars", { auth: "b".repeat(23) }, "PushSubscription_auth_base64url_check"],
      ["auth with '/'", { auth: `${"b".repeat(21)}/` }, "PushSubscription_auth_base64url_check"],
      ["empty auth", { auth: "" }, "PushSubscription_auth_base64url_check"],
      ["257-char userAgent", { userAgent: "u".repeat(257) }, "PushSubscription_userAgent_length_check"],
    ] as const)("rejects %s", async (_label, overrides, constraint) => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        insertSql,
        insertParams(tenantA, overrides),
        { code: "23514", constraint },
      );
    });

    it("rejects a negative failureCount", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "failureCount" = -1 WHERE "id" = $1`,
        [tenantA.subscriptionId],
        { code: "23514", constraint: "PushSubscription_failureCount_nonnegative_check" },
      );
    });

    it("accepts a 2048-char endpoint, real-shaped 87/22-char keys and a 256-char userAgent", async () => {
      const inserted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(insertSql, insertParams(tenantA, {
          endpoint: `https://push.example.com/${"a".repeat(2048 - "https://push.example.com/".length)}`,
          userAgent: "u".repeat(256),
        })));
      expect(inserted.rowCount).toBe(1);
    });

    it("rejects a duplicate (tenant, endpoint) insert", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        insertSql,
        insertParams(tenantA, { endpoint: tenantA.endpoint }),
        { code: "23505", constraint: "PushSubscription_tenantId_endpoint_key" },
      );
    });
  });

  describe("subscription repository", () => {
    it("same endpoint in two tenants -> two isolated rows, no unique violation (no existence oracle)", async () => {
      const endpoint = `https://push.example.com/shared-${randomUUID()}`;
      await expect(subscribe(tenantA, tenantA.staffProfileId, endpoint)).resolves.toBeUndefined();
      await expect(subscribe(tenantB, tenantB.staffProfileId, endpoint)).resolves.toBeUndefined();
      const all = await db().query(`SELECT "tenantId" FROM "${TABLE}" WHERE "endpoint" = $1 ORDER BY "tenantId"`, [endpoint]);
      expect(all.rows.map((row) => row.tenantId).sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());

      const repository = createPrismaPushNotificationRepository(client());
      const seenByA = await repository.activeSubscriptions(ctx(tenantA), tenantA.staffProfileId);
      const seenByB = await repository.activeSubscriptions(ctx(tenantB), tenantB.staffProfileId);
      const idA = (await rowsFor(tenantA.tenantId, endpoint))[0].id;
      const idB = (await rowsFor(tenantB.tenantId, endpoint))[0].id;
      expect(seenByA.map((s) => s.id)).toContain(idA);
      expect(seenByA.map((s) => s.id)).not.toContain(idB);
      expect(seenByB.map((s) => s.id)).toContain(idB);
      expect(seenByB.map((s) => s.id)).not.toContain(idA);
    });

    it("same-tenant re-subscribe reassigns the row to the latest profile and resets revocation/failures", async () => {
      const endpoint = `https://push.example.com/reassign-${randomUUID()}`;
      await subscribe(tenantA, tenantA.staffProfileId, endpoint);
      await db().query(`UPDATE "${TABLE}" SET "failureCount" = 3, "revokedAt" = now() WHERE "tenantId" = $1 AND "endpoint" = $2`, [tenantA.tenantId, endpoint]);
      const fresh = keys();
      await subscribe(tenantA, tenantA.adminProfileId, endpoint, fresh);
      const rows = await rowsFor(tenantA.tenantId, endpoint);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ profileId: tenantA.adminProfileId, p256dh: fresh.p256dh, auth: fresh.auth, failureCount: 0, revokedAt: null });
    });

    it("unsubscribe revokes only the caller's own row and never deletes it", async () => {
      const endpoint = `https://push.example.com/unsub-${randomUUID()}`;
      await subscribe(tenantA, tenantA.staffProfileId, endpoint);
      const repository = createPrismaPushSubscriptionRepository(client());
      await expect(repository.revoke(ctx(tenantA), { profileId: tenantA.otherStaffProfileId, endpoint, at: new Date() })).resolves.toBe(0);
      await expect(repository.revoke(ctx(tenantB), { profileId: tenantA.staffProfileId, endpoint, at: new Date() })).resolves.toBe(0);
      expect((await rowsFor(tenantA.tenantId, endpoint))[0].revokedAt).toBeNull();
      await expect(repository.revoke(ctx(tenantA), { profileId: tenantA.staffProfileId, endpoint, at: new Date() })).resolves.toBe(1);
      const rows = await rowsFor(tenantA.tenantId, endpoint);
      expect(rows).toHaveLength(1);
      expect(rows[0].revokedAt).not.toBeNull();
    });

    it("readEligibility reports tenant and staff status for the context tenant only", async () => {
      const repository = createPrismaPushSubscriptionRepository(client());
      await expect(repository.readEligibility(ctx(tenantA), tenantA.inactiveStaffProfileId)).resolves.toEqual({ tenantStatus: "ACTIVE", staffStatus: "INACTIVE" });
      await expect(repository.readEligibility(ctx(tenantA), tenantA.adminProfileId)).resolves.toEqual({ tenantStatus: "ACTIVE", staffStatus: null });
      await expect(repository.readEligibility(ctx(tenantA), tenantB.staffProfileId)).resolves.toEqual({ tenantStatus: "ACTIVE", staffStatus: null });
    });
  });

  describe("provider outcome bookkeeping (recordPushResult)", () => {
    const fresh = async (fixture: Fixture) => {
      const endpoint = `https://push.example.com/outcome-${randomUUID()}`;
      await subscribe(fixture, fixture.staffProfileId, endpoint);
      return { endpoint, id: (await rowsFor(fixture.tenantId, endpoint))[0].id };
    };
    const record = (fixture: Fixture, subscriptionId: string, outcome: "ok" | "gone" | "transient" | "network" | "config_error") =>
      createPrismaPushNotificationRepository(client()).recordPushResult(ctx(fixture), { subscriptionId, outcome, at: new Date() });

    it("410/404 (classified as gone) revokes immediately and the row is excluded from activeSubscriptions", async () => {
      const { endpoint, id } = await fresh(tenantA);
      await record(tenantA, id, "gone");
      const [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row.revokedAt).not.toBeNull();
      expect(row.lastFailureAt).not.toBeNull();
      const active = await createPrismaPushNotificationRepository(client()).activeSubscriptions(ctx(tenantA), tenantA.staffProfileId);
      expect(active.map((s) => s.id)).not.toContain(id);
    });

    it("4 transient failures are counted without revoking; the 5th revokes", async () => {
      const { endpoint, id } = await fresh(tenantA);
      for (let i = 0; i < 4; i += 1) await record(tenantA, id, i % 2 === 0 ? "transient" : "network");
      let [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row).toMatchObject({ failureCount: 4, revokedAt: null });
      await record(tenantA, id, "transient");
      [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row.failureCount).toBe(5);
      expect(row.revokedAt).not.toBeNull();
    });

    it("a success in between resets failureCount and sets lastSuccessAt", async () => {
      const { endpoint, id } = await fresh(tenantA);
      for (let i = 0; i < 4; i += 1) await record(tenantA, id, "transient");
      await record(tenantA, id, "ok");
      let [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row.failureCount).toBe(0);
      expect(row.lastSuccessAt).not.toBeNull();
      for (let i = 0; i < 4; i += 1) await record(tenantA, id, "transient");
      [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row).toMatchObject({ failureCount: 4, revokedAt: null });
    });

    it("config errors (400/403/413) never revoke or count", async () => {
      const { endpoint, id } = await fresh(tenantA);
      for (let i = 0; i < 6; i += 1) await record(tenantA, id, "config_error");
      const [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row).toMatchObject({ failureCount: 0, revokedAt: null });
    });

    it("another tenant's context cannot revoke or count a subscription", async () => {
      const { endpoint, id } = await fresh(tenantA);
      await record(tenantB, id, "gone");
      await record(tenantB, id, "transient");
      const [row] = await rowsFor(tenantA.tenantId, endpoint);
      expect(row).toMatchObject({ failureCount: 0, revokedAt: null });
    });
  });
});
