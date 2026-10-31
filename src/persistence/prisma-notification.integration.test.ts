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
       ORDER BY "eventType" ASC`,
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
