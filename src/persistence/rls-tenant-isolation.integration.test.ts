import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeRls = databaseUrl ? describe : describe.skip;

describeRls("PostgreSQL RLS tenant isolation", () => {
  const role = "rls_tenant_test_runner";
  const tenantA = `rls-a-${randomUUID()}`;
  const tenantB = `rls-b-${randomUUID()}`;
  const profileA = `rls-profile-a-${randomUUID()}`;
  const membershipA = `rls-membership-a-${randomUUID()}`;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });

    await pool.query(`DROP OWNED BY "${role}"`);
    await pool.query(`DROP ROLE IF EXISTS "${role}"`);
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT ON "TenantMembership" TO "${role}"`);

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone")
       VALUES ($1, $2, $3, $4, now(), now()), ($5, $6, $7, $8, now(), now())`,
      [tenantA, `rls-a-${randomUUID()}`, "RLS Tenant A", "Europe/Istanbul",
       tenantB, `rls-b-${randomUUID()}`, "RLS Tenant B", "Europe/Istanbul"],
    );

    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName")
       VALUES ($1, $2, $3)`,
      [profileA, tenantA, "RLS Test Profile"],
    );

    await pool.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role")
       VALUES ($1, $2, $3, $4, 'STAFF')`,
      [membershipA, tenantA, "rls-subject-a", profileA],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM "TenantMembership" WHERE "id" = $1', [membershipA]);
    await pool.query('DELETE FROM "Profile" WHERE "id" = $1', [profileA]);
    await pool.query('DELETE FROM "Tenant" WHERE "id" IN ($1, $2)', [tenantA, tenantB]);
    await pool.query(`DROP ROLE IF EXISTS "${role}"`);
    await pool.end();
  });

  it("permits the matching tenant context", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET ROLE \"" + role + "\"");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const result = await client.query(
        'SELECT "id" FROM "TenantMembership" WHERE "id" = $1',
        [membershipA],
      );
      await client.query("ROLLBACK");
      expect(result.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it("blocks a mismatched tenant context", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET ROLE \"" + role + "\"");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const result = await client.query(
        'SELECT "id" FROM "TenantMembership" WHERE "id" = $1',
        [membershipA],
      );
      await client.query("ROLLBACK");
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("blocks access when tenant context is absent", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET ROLE \"" + role + "\"");
      const result = await client.query(
        'SELECT "id" FROM "TenantMembership" WHERE "id" = $1',
        [membershipA],
      );
      await client.query("ROLLBACK");
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("does not leak transaction-local tenant context", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET ROLE \"" + role + "\"");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query("COMMIT");

      const result = await client.query(
        "SELECT current_setting('app.tenant_id', true) AS tenant_id",
      );
      expect(result.rows[0]?.tenant_id).toBeNull();
    } finally {
      client.release();
    }
  });
});
