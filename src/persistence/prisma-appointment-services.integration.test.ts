import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Owner decision 2026-11-06: two-tenant integration test for "AppointmentService"
// (RLS, composite FKs, position CHECK). CI only (isolated PostgreSQL 17); skipped
// without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = {
  tenantId: string; slug: string; staffProfileId: string; customerProfileId: string; staffId: string;
  serviceId: string; extraServiceId: string; appointmentId: string; rowIds: [string, string];
};

function makeFixture(label: string): Fixture {
  const suffix = randomUUID();
  const id = (kind: string) => `apptsvc-${kind}-${label}-${suffix}`;
  return {
    tenantId: id("tenant"), slug: id("slug"), staffProfileId: id("staffprofile"), customerProfileId: id("customer"), staffId: id("staff"),
    serviceId: id("service"), extraServiceId: id("extra"), appointmentId: id("appt"), rowIds: [id("row0"), id("row1")],
  };
}

describeDatabase("AppointmentService integration (owner decision 2026-11-06)", () => {
  const role = `apptsvc_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  let pool: Pool | undefined;
  let roleCreated = false;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };

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

  const seedTenant = async (f: Fixture, label: string) => {
    const p = db();
    await p.query(`INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`, [f.tenantId, f.slug, `Multi Salon ${label}`]);
    await p.query(`INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, 'Uzman', now(), now()), ($3, $2, 'Müşteri', now(), now())`, [f.staffProfileId, f.tenantId, f.customerProfileId]);
    await p.query(`INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`, [f.staffId, f.tenantId, f.staffProfileId]);
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 10, true, now(), now()), ($4, $2, $5, 20, 0, true, now(), now())`,
      [f.serviceId, f.tenantId, `Kesim ${label}`, f.extraServiceId, `Sakal ${label}`],
    );
    await p.query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PENDING', '2026-12-07T07:00:00Z', '2026-12-07T08:00:00Z', now(), now())`,
      [f.appointmentId, f.tenantId, f.staffId, f.serviceId, f.customerProfileId],
    );
    await p.query(
      `INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position") VALUES ($1, $2, $3, $4, 0), ($5, $2, $3, $6, 1)`,
      [f.rowIds[0], f.tenantId, f.appointmentId, f.serviceId, f.rowIds[1], f.extraServiceId],
    );
  };

  const cleanupTenant = async (f: Fixture) => {
    const p = db();
    for (const table of ["AppointmentService", "Appointment", "Service", "Staff", "Profile"]) {
      await p.query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [f.tenantId]);
    }
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [f.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "AppointmentService" TO "${role}"`);
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        errors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    if (roleCreated) {
      try {
        await pool.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON "AppointmentService" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      } catch (error) {
        errors.push(`test role cleanup failed: ${String(error)}`);
      }
    }
    await pool.end().catch((error) => errors.push(String(error)));
    if (errors.length > 0) throw new Error(errors.join("\n"));
  });

  it("RLS: a tenant sees and changes only its own rows", async () => {
    const visible = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('SELECT "id" FROM "AppointmentService" WHERE "id" = ANY($1) ORDER BY "position"', [[...tenantA.rowIds, ...tenantB.rowIds]]));
    expect(visible.rows.map((row) => row.id)).toEqual(tenantA.rowIds);

    const deleted = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
      c.query('DELETE FROM "AppointmentService" WHERE "id" = ANY($1)', [tenantB.rowIds]));
    expect(deleted.rowCount).toBe(0);

    const none = await inRolledBackTx({ tenantId: null, asRole: true }, (c) => c.query('SELECT count(*)::int AS n FROM "AppointmentService"'));
    expect(none.rows[0].n).toBe(0);
  });

  it("composite FKs reject another tenant's appointment or service", async () => {
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position") VALUES ($1, $2, $3, $4, 2)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantA.appointmentId, tenantB.serviceId]))).rejects.toThrow(/foreign key/i);
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position") VALUES ($1, $2, $3, $4, 2)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantB.appointmentId, tenantA.serviceId]))).rejects.toThrow(/foreign key/i);
  });

  it("allows at most 5 services and one row per position", async () => {
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position") VALUES ($1, $2, $3, $4, 5)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantA.appointmentId, tenantA.extraServiceId]))).rejects.toThrow(/position_range_check/);
    await expect(inRolledBackTx({ tenantId: null, asRole: false }, (c) =>
      c.query(`INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position") VALUES ($1, $2, $3, $4, 1)`,
        [`x-${randomUUID()}`, tenantA.tenantId, tenantA.appointmentId, tenantA.serviceId]))).rejects.toThrow(/unique/i);
  });
});
