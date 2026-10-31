import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeRls = databaseUrl ? describe : describe.skip;

type TenantFixture = {
  tenantId: string;
  customerProfileId: string;
  staffProfileId: string;
  membershipId: string;
  staffId: string;
  serviceId: string;
  workingHoursId: string;
  appointmentId: string;
  noteId: string;
  deliveryId: string;
  whatsappIntegrationId: string;
};

const makeFixture = (prefix: string): TenantFixture => ({
  tenantId: `rls-${prefix}-${randomUUID()}`,
  customerProfileId: `rls-customer-${prefix}-${randomUUID()}`,
  staffProfileId: `rls-staff-profile-${prefix}-${randomUUID()}`,
  membershipId: `rls-membership-${prefix}-${randomUUID()}`,
  staffId: `rls-staff-${prefix}-${randomUUID()}`,
  serviceId: `rls-service-${prefix}-${randomUUID()}`,
  workingHoursId: `rls-hours-${prefix}-${randomUUID()}`,
  appointmentId: `rls-appointment-${prefix}-${randomUUID()}`,
  noteId: `rls-note-${prefix}-${randomUUID()}`,
  deliveryId: `rls-delivery-${prefix}-${randomUUID()}`,
  whatsappIntegrationId: `rls-whatsapp-${prefix}-${randomUUID()}`,
});

describeRls("PostgreSQL RLS tenant isolation", () => {
  const role = `rls_tenant_test_runner_${randomUUID().replaceAll("-", "")}`;
  const fixtureA = makeFixture("a");
  const fixtureB = makeFixture("b");

  let pool: Pool;
  let roleCreated = false;

  const setTenant = async (client: PoolClient, tenantId: string) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  };

  const withTenantContext = async <T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await setTenant(client, tenantId);
      const result = await operation(client);
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } finally {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      client.release();
    }
  };

  const withRole = async <T>(
    tenantId: string | null,
    operation: (client: PoolClient) => Promise<T>,
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
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  };

  const seedTenant = async (fixture: TenantFixture, label: string) => {
    await withTenantContext(fixture.tenantId, async (client) => {
      await client.query(
        `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now())`,
        [
          fixture.customerProfileId,
          fixture.tenantId,
          `Customer ${label}`,
          fixture.staffProfileId,
          `Staff ${label}`,
        ],
      );

      await client.query(
        `INSERT INTO "TenantMembership"
          ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'STAFF', now(), now())`,
        [
          fixture.membershipId,
          fixture.tenantId,
          `rls-subject-${label}-${randomUUID()}`,
          fixture.staffProfileId,
        ],
      );

      await client.query(
        `INSERT INTO "Staff"
          ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
        [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
      );

      await client.query(
        `INSERT INTO "Service"
          ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
        [fixture.serviceId, fixture.tenantId, `Service ${label}`],
      );

      await client.query(
        `INSERT INTO "WorkingHours"
          ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
         VALUES ($1, $2, 1, 540, 1080, now(), now())`,
        [fixture.workingHoursId, fixture.tenantId],
      );

      await client.query(
        `INSERT INTO "Appointment"
          ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status",
           "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day',
                 now() + interval '1 day 30 minutes', now(), now())`,
        [
          fixture.appointmentId,
          fixture.tenantId,
          fixture.staffId,
          fixture.serviceId,
          fixture.customerProfileId,
        ],
      );

      await client.query(
        `INSERT INTO "CustomerNote"
          ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [fixture.noteId, fixture.tenantId, fixture.customerProfileId, `Tenant ${label} note`],
      );

      await client.query(
        `INSERT INTO "NotificationDelivery"
          ("id", "tenantId", "appointmentId", "eventType", "channel", "recipientProfileId",
           "templateKey", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'APPOINTMENT_CREATED', 'WHATSAPP', $4,
                 'appointment-created', 'PENDING', now(), now())`,
        [
          fixture.deliveryId,
          fixture.tenantId,
          fixture.appointmentId,
          fixture.customerProfileId,
        ],
      );

      await client.query(
        `INSERT INTO "WhatsAppIntegration"
          ("id", "tenantId", "provider", "phoneNumberId", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, 'META_WHATSAPP', $3, 'ACTIVE', now(), now())`,
        [
          fixture.whatsappIntegrationId,
          fixture.tenantId,
          `rls-phone-${label}-${randomUUID()}`,
        ],
      );
    });
  };

  const readTenantRows = async (client: PoolClient, fixture: TenantFixture) => {
    const result = await Promise.all([
      client.query('SELECT "id" FROM "Profile" WHERE "id" = $1', [fixture.customerProfileId]),
      client.query('SELECT "id" FROM "TenantMembership" WHERE "id" = $1', [fixture.membershipId]),
      client.query('SELECT "id" FROM "Staff" WHERE "id" = $1', [fixture.staffId]),
      client.query('SELECT "id" FROM "Service" WHERE "id" = $1', [fixture.serviceId]),
      client.query('SELECT "id" FROM "WorkingHours" WHERE "id" = $1', [fixture.workingHoursId]),
      client.query('SELECT "id" FROM "Appointment" WHERE "id" = $1', [fixture.appointmentId]),
      client.query('SELECT "id" FROM "CustomerNote" WHERE "id" = $1', [fixture.noteId]),
      client.query('SELECT "id" FROM "NotificationDelivery" WHERE "id" = $1', [fixture.deliveryId]),
      client.query('SELECT "id" FROM "WhatsAppIntegration" WHERE "id" = $1', [fixture.whatsappIntegrationId]),
    ]);

    return result.map((item) => item.rowCount);
  };

  const deleteTenantFixtures = async (fixture: TenantFixture) => {
    await withTenantContext(fixture.tenantId, async (client) => {
      await client.query('DELETE FROM "NotificationDelivery" WHERE "id" = $1', [fixture.deliveryId]);
      await client.query('DELETE FROM "WhatsAppIntegration" WHERE "id" = $1', [fixture.whatsappIntegrationId]);
      await client.query('DELETE FROM "CustomerNote" WHERE "id" = $1', [fixture.noteId]);
      await client.query('DELETE FROM "Appointment" WHERE "id" = $1', [fixture.appointmentId]);
      await client.query('DELETE FROM "WorkingHours" WHERE "id" = $1', [fixture.workingHoursId]);
      await client.query('DELETE FROM "Service" WHERE "id" = $1', [fixture.serviceId]);
      await client.query('DELETE FROM "Staff" WHERE "id" = $1', [fixture.staffId]);
      await client.query('DELETE FROM "TenantMembership" WHERE "id" = $1', [fixture.membershipId]);
      await client.query(
        'DELETE FROM "Profile" WHERE "id" IN ($1, $2)',
        [fixture.customerProfileId, fixture.staffProfileId],
      );
    });
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
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
      "WhatsAppIntegration",
    ]) {
      await pool.query(`GRANT SELECT, UPDATE, DELETE ON "${table}" TO "${role}"`);
    }

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now()), ($5, $6, $7, $8, now(), now())`,
      [
        fixtureA.tenantId,
        `rls-a-${randomUUID()}`,
        "RLS Tenant A",
        "Europe/Istanbul",
        fixtureB.tenantId,
        `rls-b-${randomUUID()}`,
        "RLS Tenant B",
        "Europe/Istanbul",
      ],
    );

    await seedTenant(fixtureA, "A");
    await seedTenant(fixtureB, "B");
  });

  afterAll(async () => {
    if (!pool) return;

    const cleanupErrors: string[] = [];

    try {
      for (const fixture of [fixtureA, fixtureB]) {
        try {
          await deleteTenantFixtures(fixture);
        } catch (error) {
          cleanupErrors.push(`tenant fixture cleanup failed: ${String(error)}`);
        }
      }

      try {
        await pool.query('DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])', [
          [fixtureA.tenantId, fixtureB.tenantId],
        ]);
      } catch (error) {
        cleanupErrors.push(`tenant cleanup failed: ${String(error)}`);
      }

      if (roleCreated) {
        try {
          for (const table of [
            "Profile",
            "TenantMembership",
            "Staff",
            "Service",
            "WorkingHours",
            "Appointment",
            "CustomerNote",
            "NotificationDelivery",
            "WhatsAppIntegration",
          ]) {
            await pool.query(`REVOKE SELECT, UPDATE, DELETE ON "${table}" FROM "${role}"`);
          }
          await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
          await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
          await pool.query(`DROP ROLE IF EXISTS "${role}"`);
        } catch (error) {
          cleanupErrors.push(`test role cleanup failed: ${String(error)}`);
        }
      }
    } finally {
      await pool.end();
    }

    if (cleanupErrors.length > 0) {
      throw new Error(cleanupErrors.join("\n"));
    }
  });

  it("allows a tenant to see its own records across tenant-owned tables", async () => {
    const counts = await withRole(fixtureA.tenantId, (client) => readTenantRows(client, fixtureA));

    expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("blocks a tenant from reading another tenant's records across tenant-owned tables", async () => {
    const counts = await withRole(fixtureB.tenantId, (client) => readTenantRows(client, fixtureA));

    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("blocks cross-tenant mutation by direct identifier manipulation", async () => {
    const result = await withRole(fixtureB.tenantId, async (client) => {
      const profileUpdate = await client.query(
        'UPDATE "Profile" SET "displayName" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", fixtureA.customerProfileId],
      );
      const appointmentDelete = await client.query(
        'DELETE FROM "Appointment" WHERE "id" = $1',
        [fixtureA.appointmentId],
      );
      const noteUpdate = await client.query(
        'UPDATE "CustomerNote" SET "body" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", fixtureA.noteId],
      );
      const deliveryUpdate = await client.query(
        'UPDATE "NotificationDelivery" SET "status" = $1 WHERE "id" = $2',
        ["SENT", fixtureA.deliveryId],
      );
      const whatsappUpdate = await client.query(
        'UPDATE "WhatsAppIntegration" SET "status" = $1 WHERE "id" = $2',
        ["INACTIVE", fixtureA.whatsappIntegrationId],
      );
      const staffUpdate = await client.query(
        'UPDATE "Staff" SET "status" = $1 WHERE "id" = $2',
        ["INACTIVE", fixtureA.staffId],
      );
      const serviceUpdate = await client.query(
        'UPDATE "Service" SET "active" = $1 WHERE "id" = $2',
        [false, fixtureA.serviceId],
      );
      const workingHoursUpdate = await client.query(
        'UPDATE "WorkingHours" SET "openMinute" = $1 WHERE "id" = $2',
        [600, fixtureA.workingHoursId],
      );

      return [
        profileUpdate.rowCount,
        appointmentDelete.rowCount,
        noteUpdate.rowCount,
        deliveryUpdate.rowCount,
        whatsappUpdate.rowCount,
        staffUpdate.rowCount,
        serviceUpdate.rowCount,
        workingHoursUpdate.rowCount,
      ];
    });

    expect(result).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("blocks access when tenant context is absent", async () => {
    const counts = await withRole(null, (client) => readTenantRows(client, fixtureA));

    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("does not leak transaction-local tenant context", async () => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`SET ROLE "${role}"`);
      await setTenant(client, fixtureA.tenantId);
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
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  });

  it("enforces reciprocal Tenant B isolation", async () => {
    const ownCounts = await withRole(fixtureB.tenantId, (client) => readTenantRows(client, fixtureB));
    const crossTenantCounts = await withRole(fixtureA.tenantId, (client) => readTenantRows(client, fixtureB));

    expect(ownCounts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(crossTenantCounts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("blocks reverse-direction cross-tenant mutations by direct identifiers", async () => {
    const result = await withRole(fixtureA.tenantId, async (client) => {
      const profileUpdate = await client.query(
        'UPDATE "Profile" SET "displayName" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", fixtureB.customerProfileId],
      );
      const appointmentDelete = await client.query(
        'DELETE FROM "Appointment" WHERE "id" = $1',
        [fixtureB.appointmentId],
      );
      const noteUpdate = await client.query(
        'UPDATE "CustomerNote" SET "body" = $1 WHERE "id" = $2',
        ["cross-tenant-attempt", fixtureB.noteId],
      );
      const deliveryUpdate = await client.query(
        'UPDATE "NotificationDelivery" SET "status" = $1 WHERE "id" = $2',
        ["SENT", fixtureB.deliveryId],
      );
      const whatsappUpdate = await client.query(
        'UPDATE "WhatsAppIntegration" SET "status" = $1 WHERE "id" = $2',
        ["INACTIVE", fixtureB.whatsappIntegrationId],
      );
      const staffUpdate = await client.query(
        'UPDATE "Staff" SET "status" = $1 WHERE "id" = $2',
        ["INACTIVE", fixtureB.staffId],
      );
      const serviceUpdate = await client.query(
        'UPDATE "Service" SET "active" = $1 WHERE "id" = $2',
        [false, fixtureB.serviceId],
      );
      const workingHoursUpdate = await client.query(
        'UPDATE "WorkingHours" SET "openMinute" = $1 WHERE "id" = $2',
        [600, fixtureB.workingHoursId],
      );

      return [
        profileUpdate.rowCount,
        appointmentDelete.rowCount,
        noteUpdate.rowCount,
        deliveryUpdate.rowCount,
        whatsappUpdate.rowCount,
        staffUpdate.rowCount,
        serviceUpdate.rowCount,
        workingHoursUpdate.rowCount,
      ];
    });

    expect(result).toEqual([0, 0, 0, 0, 0]);
  });

});