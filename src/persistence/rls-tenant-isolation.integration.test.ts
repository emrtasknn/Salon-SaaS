import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeRls = databaseUrl ? describe : describe.skip;

describeRls("PostgreSQL RLS tenant isolation", () => {
  const role = `rls_tenant_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = `rls-a-${randomUUID()}`;
  const tenantB = `rls-b-${randomUUID()}`;

  const profileA = `rls-profile-a-${randomUUID()}`;
  const profileB = `rls-profile-b-${randomUUID()}`;
  const staffProfileA = `rls-staff-profile-a-${randomUUID()}`;
  const staffProfileB = `rls-staff-profile-b-${randomUUID()}`;
  const membershipA = `rls-membership-a-${randomUUID()}`;
  const membershipB = `rls-membership-b-${randomUUID()}`;
  const staffA = `rls-staff-a-${randomUUID()}`;
  const staffB = `rls-staff-b-${randomUUID()}`;
  const serviceA = `rls-service-a-${randomUUID()}`;
  const serviceB = `rls-service-b-${randomUUID()}`;
  const workingHoursA = `rls-hours-a-${randomUUID()}`;
  const workingHoursB = `rls-hours-b-${randomUUID()}`;
  const appointmentA = `rls-appointment-a-${randomUUID()}`;
  const appointmentB = `rls-appointment-b-${randomUUID()}`;
  const noteA = `rls-note-a-${randomUUID()}`;
  const noteB = `rls-note-b-${randomUUID()}`;
  const deliveryA = `rls-delivery-a-${randomUUID()}`;
  const deliveryB = `rls-delivery-b-${randomUUID()}`;

  let pool: Pool;

  const setTenant = async (client: import("pg").PoolClient, tenantId: string) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  };

  const withRole = async <T>(
    tenantId: string | null,
    operation: (client: import("pg").PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`SET ROLE "${role}"`);
      if (tenantId) await setTenant(client, tenantId);
      const result = await operation(client);
      await client.query("ROLLBACK");
      transactionStarted = false;
      return result;
    } finally {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      await client.query("RESET ROLE");
      client.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    for (const table of [
      "Profile",
      "TenantMembership",
      "Staff",
      "Service",
      "WorkingHours",
      "Appointment",
      "CustomerNote",
      "NotificationDelivery",
    ]) {
      await pool.query(`GRANT SELECT, UPDATE, DELETE ON "${table}" TO "${role}"`);
    }

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now()), ($5, $6, $7, $8, now(), now())`,
      [
        tenantA,
        `rls-a-${randomUUID()}`,
        "RLS Tenant A",
        "Europe/Istanbul",
        tenantB,
        `rls-b-${randomUUID()}`,
        "RLS Tenant B",
        "Europe/Istanbul",
      ],
    );

    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES
         ($1, $2, 'Customer A', now(), now()),
         ($3, $4, 'Customer B', now(), now()),
         ($5, $6, 'Staff A', now(), now()),
         ($7, $8, 'Staff B', now(), now())`,
      [profileA, tenantA, profileB, tenantB, staffProfileA, tenantA, staffProfileB, tenantB],
    );

    await pool.query(
      `INSERT INTO "TenantMembership"
        ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'STAFF', now(), now()),
         ($5, $6, $7, $8, 'STAFF', now(), now())`,
      [
        membershipA,
        tenantA,
        `rls-subject-a-${randomUUID()}`,
        staffProfileA,
        membershipB,
        tenantB,
        `rls-subject-b-${randomUUID()}`,
        staffProfileB,
      ],
    );

    await pool.query(
      `INSERT INTO "Staff"
        ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, 'ACTIVE', now(), now()),
         ($4, $5, $6, 'ACTIVE', now(), now())`,
      [staffA, tenantA, staffProfileA, staffB, tenantB, staffProfileB],
    );

    await pool.query(
      `INSERT INTO "Service"
        ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES
         ($1, $2, 'Service A', 30, 0, true, now(), now()),
         ($3, $4, 'Service B', 30, 0, true, now(), now())`,
      [serviceA, tenantA, serviceB, tenantB],
    );

    await pool.query(
      `INSERT INTO "WorkingHours"
        ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES
         ($1, $2, 1, 540, 1080, now(), now()),
         ($3, $4, 1, 540, 1080, now(), now())`,
      [workingHoursA, tenantA, workingHoursB, tenantB],
    );

    await pool.query(
      `INSERT INTO "Appointment"
        ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status",
         "startAt", "endAt", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, 'PENDING', '2026-10-12T09:00:00Z', '2026-10-12T09:30:00Z', now(), now()),
         ($6, $7, $8, $9, $10, 'PENDING', '2026-10-12T09:00:00Z', '2026-10-12T09:30:00Z', now(), now())`,
      [
        appointmentA,
        tenantA,
        staffA,
        serviceA,
        profileA,
        appointmentB,
        tenantB,
        staffB,
        serviceB,
        profileB,
      ],
    );

    await pool.query(
      `INSERT INTO "CustomerNote"
        ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, 'Tenant A note', now(), now()),
         ($4, $5, $6, 'Tenant B note', now(), now())`,
      [noteA, tenantA, profileA, noteB, tenantB, profileB],
    );

    await pool.query(
      `INSERT INTO "NotificationDelivery"
        ("id", "tenantId", "appointmentId", "eventType", "channel", "recipientProfileId",
         "templateKey", "status", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, 'APPOINTMENT_CREATED', 'WHATSAPP', $4, 'appointment-created', 'PENDING', now(), now()),
         ($5, $6, $7, 'APPOINTMENT_CREATED', 'WHATSAPP', $8, 'appointment-created', 'PENDING', now(), now())`,
      [deliveryA, tenantA, appointmentA, profileA, deliveryB, tenantB, appointmentB, profileB],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM "NotificationDelivery" WHERE "id" IN ($1, $2)', [deliveryA, deliveryB]);
    await pool.query('DELETE FROM "CustomerNote" WHERE "id" IN ($1, $2)', [noteA, noteB]);
    await pool.query('DELETE FROM "Appointment" WHERE "id" IN ($1, $2)', [appointmentA, appointmentB]);
    await pool.query('DELETE FROM "WorkingHours" WHERE "id" IN ($1, $2)', [workingHoursA, workingHoursB]);
    await pool.query('DELETE FROM "Service" WHERE "id" IN ($1, $2)', [serviceA, serviceB]);
    await pool.query('DELETE FROM "Staff" WHERE "id" IN ($1, $2)', [staffA, staffB]);
    await pool.query('DELETE FROM "TenantMembership" WHERE "id" IN ($1, $2)', [membershipA, membershipB]);
    await pool.query('DELETE FROM "Profile" WHERE "id" IN ($1, $2, $3, $4)', [profileA, profileB, staffProfileA, staffProfileB]);
    await pool.query('DELETE FROM "Tenant" WHERE "id" IN ($1, $2)', [tenantA, tenantB]);
    await pool.query(`DROP OWNED BY "${role}"`);
    await pool.query(`DROP ROLE IF EXISTS "${role}"`);
    await pool.end();
  });

  it("allows a tenant to see its own records across tenant-owned tables", async () => {
    const counts = await withRole(tenantA, async (client) => {
      const result = await Promise.all([
        client.query('SELECT "id" FROM "Profile" WHERE "id" = $1', [profileA]),
        client.query('SELECT "id" FROM "TenantMembership" WHERE "id" = $1', [membershipA]),
        client.query('SELECT "id" FROM "Staff" WHERE "id" = $1', [staffA]),
        client.query('SELECT "id" FROM "Service" WHERE "id" = $1', [serviceA]),
        client.query('SELECT "id" FROM "WorkingHours" WHERE "id" = $1', [workingHoursA]),
        client.query('SELECT "id" FROM "Appointment" WHERE "id" = $1', [appointmentA]),
        client.query('SELECT "id" FROM "CustomerNote" WHERE "id" = $1', [noteA]),
        client.query('SELECT "id" FROM "NotificationDelivery" WHERE "id" = $1', [deliveryA]),
      ]);
      return result.map((item) => item.rowCount);
    });

    expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("blocks a tenant from reading another tenant's records across tenant-owned tables", async () => {
    const counts = await withRole(tenantB, async (client) => {
      const result = await Promise.all([
        client.query('SELECT "id" FROM "Profile" WHERE "id" = $1', [profileA]),
        client.query('SELECT "id" FROM "TenantMembership" WHERE "id" = $1', [membershipA]),
        client.query('SELECT "id" FROM "Staff" WHERE "id" = $1', [staffA]),
        client.query('SELECT "id" FROM "Service" WHERE "id" = $1', [serviceA]),
        client.query('SELECT "id" FROM "WorkingHours" WHERE "id" = $1', [workingHoursA]),
        client.query('SELECT "id" FROM "Appointment" WHERE "id" = $1', [appointmentA]),
        client.query('SELECT "id" FROM "CustomerNote" WHERE "id" = $1', [noteA]),
        client.query('SELECT "id" FROM "NotificationDelivery" WHERE "id" = $1', [deliveryA]),
      ]);
      return result.map((item) => item.rowCount);
    });

    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("blocks cross-tenant mutation by direct identifier manipulation", async () => {
    const result = await withRole(tenantB, async (client) => {
      const profileUpdate = await client.query(
        'UPDATE "Profile" SET "displayName" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", profileA],
      );
      const appointmentDelete = await client.query(
        'DELETE FROM "Appointment" WHERE "id" = $1',
        [appointmentA],
      );
      const noteUpdate = await client.query(
        'UPDATE "CustomerNote" SET "body" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", noteA],
      );
      const deliveryUpdate = await client.query(
        'UPDATE "NotificationDelivery" SET "status" = $1 WHERE "id" = $2',
        ["SENT", deliveryA],
      );
      return [profileUpdate.rowCount, appointmentDelete.rowCount, noteUpdate.rowCount, deliveryUpdate.rowCount];
    });

    expect(result).toEqual([0, 0, 0, 0]);
  });

  it("blocks access when tenant context is absent", async () => {
    const counts = await withRole(null, async (client) => {
      const result = await Promise.all([
        client.query('SELECT "id" FROM "Profile" WHERE "id" = $1', [profileA]),
        client.query('SELECT "id" FROM "Staff" WHERE "id" = $1', [staffA]),
        client.query('SELECT "id" FROM "Service" WHERE "id" = $1', [serviceA]),
        client.query('SELECT "id" FROM "WorkingHours" WHERE "id" = $1', [workingHoursA]),
        client.query('SELECT "id" FROM "Appointment" WHERE "id" = $1', [appointmentA]),
        client.query('SELECT "id" FROM "CustomerNote" WHERE "id" = $1', [noteA]),
        client.query('SELECT "id" FROM "NotificationDelivery" WHERE "id" = $1', [deliveryA]),
      ]);
      return result.map((item) => item.rowCount);
    });

    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("does not leak transaction-local tenant context", async () => {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`SET ROLE "${role}"`);
      await setTenant(client, tenantA);
      await client.query("COMMIT");
      transactionStarted = false;

      const result = await client.query(
        "SELECT current_setting('app.tenant_id', true) AS tenant_id",
      );
      expect(result.rows[0]?.tenant_id ?? "").toBe("");
    } finally {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      await client.query("RESET ROLE");
      client.release();
    }
  });
});
