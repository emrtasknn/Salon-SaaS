import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaNotificationRepository } from "./prisma-notification";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Prisma notification delivery idempotency integration", () => {
  const suffix = randomUUID();
  const tenantId = `notification-idempotency-${suffix}`;
  const slug = `notification-idempotency-${suffix}`;
  const staffProfileId = `notification-staff-${suffix}`;
  const customerProfileId = `notification-customer-${suffix}`;
  const staffId = `notification-staff-record-${suffix}`;
  const serviceId = `notification-service-${suffix}`;
  const appointmentId = `notification-appointment-${suffix}`;

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Notification Idempotency Tenant', 'Europe/Istanbul', now(), now())`,
      [tenantId, slug],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "phone", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Integration Staff', '+905550000001', now(), now()),
              ($3, $2, 'Integration Customer', '+905550000002', now(), now())`,
      [staffProfileId, tenantId, customerProfileId],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [staffId, tenantId, staffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Integration Service', 30, 0, true, now(), now())`,
      [serviceId, tenantId],
    );
    await pool.query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day', now() + interval '1 day 30 minutes', now(), now())`,
      [appointmentId, tenantId, staffId, serviceId, customerProfileId],
    );
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const errors: string[] = [];
    try {
      await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [tenantId]);
      await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [tenantId]);
      await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [tenantId]);
      await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [tenantId]);
      await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [tenantId]);
      await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [tenantId]);
    } catch (error) {
      errors.push(`fixture cleanup failed: ${String(error)}`);
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      errors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("persists SENT, UNKNOWN, and FAILED idempotency states across real PostgreSQL claims", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaNotificationRepository(prisma as unknown as PrismaTenantClient);
    const context = { tenantId: tenantId as never };

    const created = {
      appointmentId,
      eventType: "APPOINTMENT_CREATED" as const,
      channel: "WHATSAPP" as const,
      recipientProfileId: customerProfileId,
      templateKey: "appointment-created-customer",
    };
    expect(await repository.claim(context, created)).toBe("claimed");
    expect(await repository.claim(context, created)).toBe("already_pending");
    await repository.markSent(context, {
      ...created,
      providerMessageId: "integration-provider-message-id",
    });
    expect(await repository.claim(context, created)).toBe("already_sent");

    const confirmed = {
      appointmentId,
      eventType: "APPOINTMENT_CONFIRMED" as const,
      channel: "WHATSAPP" as const,
      recipientProfileId: customerProfileId,
      templateKey: "appointment-confirmed-customer",
    };
    expect(await repository.claim(context, confirmed)).toBe("claimed");
    await repository.markUnknown(context, {
      ...confirmed,
      errorCode: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(await repository.claim(context, confirmed)).toBe("already_unknown");

    const rejected = {
      appointmentId,
      eventType: "APPOINTMENT_REJECTED" as const,
      channel: "WHATSAPP" as const,
      recipientProfileId: customerProfileId,
      templateKey: "appointment-rejected-customer",
    };
    expect(await repository.claim(context, rejected)).toBe("claimed");
    await repository.markFailed(context, {
      ...rejected,
      errorCode: "WHATSAPP_PROVIDER_HTTP_400",
    });
    expect(await repository.claim(context, rejected)).toBe("claimed");

    const rows = await pool.query(
      `SELECT "eventType", "status", "attemptCount", "providerMessageId", "lastErrorCode"
       FROM "NotificationDelivery"
       WHERE "tenantId" = $1 AND "appointmentId" = $2
       ORDER BY "eventType"::text ASC`,
      [tenantId, appointmentId],
    );
    expect(rows.rows).toEqual([
      {
        eventType: "APPOINTMENT_CONFIRMED",
        status: "UNKNOWN",
        attemptCount: 1,
        providerMessageId: null,
        lastErrorCode: "PROVIDER_OUTCOME_UNKNOWN",
      },
      {
        eventType: "APPOINTMENT_CREATED",
        status: "SENT",
        attemptCount: 1,
        providerMessageId: "integration-provider-message-id",
        lastErrorCode: null,
      },
      {
        eventType: "APPOINTMENT_REJECTED",
        status: "PENDING",
        attemptCount: 1,
        providerMessageId: null,
        lastErrorCode: "WHATSAPP_PROVIDER_HTTP_400",
      },
    ]);
  });
});

describeDatabase("Prisma notification tenant admin recipients integration (WP-02b)", () => {
  const suffix = randomUUID();
  function fixture(label: "a" | "b") {
    return {
      tenantId: `notification-admins-${label}-${suffix}`,
      slug: `notification-admins-${label}-${suffix}`,
      staffProfileId: `notification-admins-staff-${label}-${suffix}`,
      customerProfileId: `notification-admins-customer-${label}-${suffix}`,
      adminOneProfileId: `notification-admins-admin1-${label}-${suffix}`,
      adminTwoProfileId: `notification-admins-admin2-${label}-${suffix}`,
      staffId: `notification-admins-staff-record-${label}-${suffix}`,
      serviceId: `notification-admins-service-${label}-${suffix}`,
      appointmentId: `notification-admins-appointment-${label}-${suffix}`,
    };
  }
  const tenantA = fixture("a");
  const tenantB = fixture("b");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  async function seed(f: ReturnType<typeof fixture>, phonePrefix: string) {
    if (!pool) throw new Error("PostgreSQL pool was not initialized");
    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Notification Admins Tenant', 'Europe/Istanbul', now(), now())`,
      [f.tenantId, f.slug],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "phone", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Admins Staff', $3, now(), now()),
              ($4, $2, 'Admins Customer', $5, now(), now()),
              ($6, $2, 'Admin One', $7, now(), now()),
              ($8, $2, 'Admin Two', $9, now(), now())`,
      [
        f.staffProfileId, f.tenantId, `${phonePrefix}01`,
        f.customerProfileId, `${phonePrefix}02`,
        f.adminOneProfileId, `${phonePrefix}11`,
        f.adminTwoProfileId, `${phonePrefix}12`,
      ],
    );
    // The assigned staff member is also a TENANT_ADMIN, so it must yield a single recipient/row.
    await pool.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'TENANT_ADMIN', now(), now()),
              ($5, $2, $6, $7, 'TENANT_ADMIN', now(), now()),
              ($8, $2, $9, $10, 'TENANT_ADMIN', now(), now())`,
      [
        `${f.adminOneProfileId}-membership`, f.tenantId, `${f.adminOneProfileId}-subject`, f.adminOneProfileId,
        `${f.adminTwoProfileId}-membership`, `${f.adminTwoProfileId}-subject`, f.adminTwoProfileId,
        `${f.staffProfileId}-membership`, `${f.staffProfileId}-subject`, f.staffProfileId,
      ],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [f.staffId, f.tenantId, f.staffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Admins Service', 30, 0, true, now(), now())`,
      [f.serviceId, f.tenantId],
    );
    await pool.query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day', now() + interval '1 day 30 minutes', now(), now())`,
      [f.appointmentId, f.tenantId, f.staffId, f.serviceId, f.customerProfileId],
    );
  }

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seed(tenantA, "+9055510000");
    await seed(tenantB, "+9055520000");
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const errors: string[] = [];
    for (const f of [tenantA, tenantB]) {
      try {
        await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "TenantMembership" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [f.tenantId]);
      } catch (error) {
        errors.push(`fixture cleanup failed for ${f.tenantId}: ${String(error)}`);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      errors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("resolves only same-tenant TENANT_ADMIN recipients and never another tenant's admins", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaNotificationRepository(prisma as unknown as PrismaTenantClient);

    const recipientsA = await repository.recipients({ tenantId: tenantA.tenantId as never }, tenantA.appointmentId, "APPOINTMENT_CREATED");
    const idsA = recipientsA.map((recipient) => recipient.profileId);
    expect(idsA).toEqual([
      tenantA.staffProfileId,
      tenantA.customerProfileId,
      ...[tenantA.adminOneProfileId, tenantA.adminTwoProfileId].sort(),
    ]);
    for (const foreign of [tenantB.staffProfileId, tenantB.customerProfileId, tenantB.adminOneProfileId, tenantB.adminTwoProfileId]) {
      expect(idsA).not.toContain(foreign);
    }

    // Tenant A context cannot resolve tenant B's appointment (and thus none of tenant B's admins).
    await expect(
      repository.recipients({ tenantId: tenantA.tenantId as never }, tenantB.appointmentId, "APPOINTMENT_CREATED"),
    ).resolves.toEqual([]);
  });

  it("stores one delivery row per admin, one row for an admin who is the staff member, and no duplicates on replay", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaNotificationRepository(prisma as unknown as PrismaTenantClient);
    const context = { tenantId: tenantA.tenantId as never };

    for (const recipient of await repository.recipients(context, tenantA.appointmentId, "APPOINTMENT_CREATED")) {
      const input = {
        appointmentId: tenantA.appointmentId,
        eventType: "APPOINTMENT_CREATED" as const,
        channel: "WHATSAPP" as const,
        recipientProfileId: recipient.profileId,
        templateKey: recipient.templateKey,
      };
      expect(await repository.claim(context, input)).toBe("claimed");
      await repository.markSent(context, { ...input, providerMessageId: `integration-${recipient.profileId}` });
    }
    // Replay: every recipient is already sent, so nothing is reclaimed.
    for (const recipient of await repository.recipients(context, tenantA.appointmentId, "APPOINTMENT_CREATED")) {
      expect(await repository.claim(context, {
        appointmentId: tenantA.appointmentId,
        eventType: "APPOINTMENT_CREATED",
        channel: "WHATSAPP",
        recipientProfileId: recipient.profileId,
        templateKey: recipient.templateKey,
      })).toBe("already_sent");
    }

    const rows = await pool.query(
      `SELECT "recipientProfileId", "templateKey", "status", "attemptCount"
       FROM "NotificationDelivery"
       WHERE "tenantId" = $1 AND "appointmentId" = $2 AND "eventType" = 'APPOINTMENT_CREATED'
       ORDER BY "recipientProfileId" ASC`,
      [tenantA.tenantId, tenantA.appointmentId],
    );
    const expected = [
      { recipientProfileId: tenantA.staffProfileId, templateKey: "appointment-created-staff" },
      { recipientProfileId: tenantA.customerProfileId, templateKey: "appointment-created-customer" },
      { recipientProfileId: tenantA.adminOneProfileId, templateKey: "appointment-created-staff" },
      { recipientProfileId: tenantA.adminTwoProfileId, templateKey: "appointment-created-staff" },
    ]
      .sort((left, right) => (left.recipientProfileId < right.recipientProfileId ? -1 : 1))
      .map((row) => ({ ...row, status: "SENT", attemptCount: 1 }));
    expect(rows.rows).toEqual(expected);
    expect(rows.rows.filter((row) => row.recipientProfileId === tenantA.staffProfileId)).toHaveLength(1);

    const foreignRows = await pool.query('SELECT count(*)::int AS count FROM "NotificationDelivery" WHERE "tenantId" = $1', [tenantB.tenantId]);
    expect(foreignRows.rows[0].count).toBe(0);
  });
});
