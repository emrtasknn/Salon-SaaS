import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createNotificationService } from "../application/notification-service";
import { createMetaWhatsAppProvider } from "../infrastructure/notifications";
import type { WebPushSender } from "../domain/web-push";
import { createPrismaNotificationRepository } from "./prisma-notification";
import { createPrismaPushNotificationRepository, createPrismaPushSubscriptionRepository } from "./prisma-push-subscription";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { publicContactInsert } from "../test/legal-fixtures";

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

  it("keeps one delivery per reschedule (eventKey) and records a missing template as FAILED", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const repository = createPrismaNotificationRepository(prisma as unknown as PrismaTenantClient);
    const context = { tenantId: tenantId as never };
    const base = {
      appointmentId,
      eventType: "APPOINTMENT_RESCHEDULED" as const,
      channel: "WHATSAPP" as const,
      recipientProfileId: customerProfileId,
      templateKey: "appointment-rescheduled-customer",
    };

    // First move: delivered once; replaying the same key never re-sends.
    expect(await repository.claim(context, { ...base, eventKey: "move-1" })).toBe("claimed");
    await repository.markSent(context, { ...base, eventKey: "move-1", providerMessageId: `integration-reschedule-${suffix}` });
    expect(await repository.claim(context, { ...base, eventKey: "move-1" })).toBe("already_sent");

    // Second move of the same appointment: a new key is deliverable again. The real service with a
    // Meta provider that has no template for this key records a clean FAILED row (no exception).
    const service = createNotificationService({
      repository: {
        ...repository,
        // The fixture has no opt-in contact; routing is unit-tested. Exercise the real claim/mark path.
        async recipients() {
          return [{ profileId: customerProfileId, displayName: "Integration Customer", phone: "+905550000002", templateKey: "appointment-rescheduled-customer", body: "x", templateParameters: ["s", "t", "u"] }];
        },
      },
      provider: createMetaWhatsAppProvider({ accessToken: "unused", phoneNumberId: "unused", apiVersion: "v23.0", templates: {}, fetchImpl: async () => { throw new Error("must not call Meta"); } }),
    });
    await expect(service.publish(context, appointmentId, "APPOINTMENT_RESCHEDULED", "move-2"))
      .resolves.toEqual({ status: "processed", results: [{ profileId: customerProfileId, status: "FAILED", channel: "WHATSAPP" }] });

    const rows = await pool.query(
      `SELECT "eventKey", "status", "attemptCount", "lastErrorCode"
       FROM "NotificationDelivery"
       WHERE "tenantId" = $1 AND "appointmentId" = $2 AND "eventType" = 'APPOINTMENT_RESCHEDULED'
       ORDER BY "eventKey" ASC`,
      [tenantId, appointmentId],
    );
    expect(rows.rows).toEqual([
      { eventKey: "move-1", status: "SENT", attemptCount: 1, lastErrorCode: null },
      { eventKey: "move-2", status: "FAILED", attemptCount: 1, lastErrorCode: "WHATSAPP_TEMPLATE_NOT_CONFIGURED" },
    ]);

    // One-off events written without a key keep the '' default (their idempotency is unchanged).
    const oneOff = await pool.query(
      `SELECT DISTINCT "eventKey" FROM "NotificationDelivery"
       WHERE "tenantId" = $1 AND "appointmentId" = $2 AND "eventType" <> 'APPOINTMENT_RESCHEDULED'`,
      [tenantId, appointmentId],
    );
    expect(oneOff.rows).toEqual([{ eventKey: "" }]);
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
    // WP-10: the customer is a WhatsApp recipient only with an opt-in contact snapshot.
    await pool.query(...publicContactInsert({
      tenantId: f.tenantId, appointmentId: f.appointmentId, tenantName: "Notification Admins Tenant",
      displayName: "Admins Customer", phone: `${phonePrefix}02`, optIn: true,
    }));
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
        await pool.query('DELETE FROM "AppointmentContact" WHERE "tenantId" = $1', [f.tenantId]);
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

describeDatabase("Prisma notification Web Push routing integration (WP-09)", () => {
  const suffix = randomUUID();
  function fixture(label: "a" | "b") {
    const id = (name: string) => `notification-push-${name}-${label}-${suffix}`;
    return {
      tenantId: id("tenant"),
      slug: id("tenant"),
      customerProfileId: id("customer"),
      adminProfileId: id("admin"),
      // TENANT_ADMIN who also has an INACTIVE Staff row: admin wins.
      adminStaffProfileId: id("admin-staff"),
      // TENANT_ADMIN with no subscription: no WEB_PUSH row at all.
      adminNoSubProfileId: id("admin-nosub"),
      activeStaffProfileId: id("active-staff"),
      inactiveStaffProfileId: id("inactive-staff"),
      removedStaffProfileId: id("removed-staff"),
      serviceId: id("service"),
      staff: {
        active: id("staff-active"),
        inactive: id("staff-inactive"),
        adminInactive: id("staff-admin-inactive"),
        removed: id("staff-removed"),
      },
      appointments: {
        active: id("appt-active"),
        inactive: id("appt-inactive"),
        adminInactive: id("appt-admin-inactive"),
        removed: id("appt-removed"),
      },
    };
  }
  type Fixture = ReturnType<typeof fixture>;
  const tenantA = fixture("a");
  const tenantB = fixture("b");
  // The same browser endpoint is subscribed by each tenant's admin (per-tenant unique, not global).
  const sharedEndpoint = `https://push.example.com/shared-${suffix}`;
  const endpointOf = (f: Fixture, profileId: string) => (profileId === f.adminProfileId ? sharedEndpoint : `https://push.example.com/${profileId}`);
  const sorted = (values: string[]) => [...values].sort();

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const db = () => {
    if (!pool) throw new Error("PostgreSQL pool was not initialized");
    return pool;
  };
  const client = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaTenantClient;
  };
  const ctx = (f: Fixture) => ({ tenantId: f.tenantId as never });

  /** Real-shaped unpadded base64url keys (87 chars starting with "B", 22 chars). */
  function keys(seed: string) {
    const material = Buffer.from(seed.repeat(4)).toString("base64url");
    return { p256dh: `B${material.slice(0, 86)}`, auth: material.slice(0, 22) };
  }

  async function seed(f: Fixture, phonePrefix: string) {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Notification Push Tenant', 'Europe/Istanbul', now(), now())`,
      [f.tenantId, f.slug],
    );
    const profiles: Array<[string, string, string]> = [
      [f.customerProfileId, "Push Customer Ayşe", `${phonePrefix}01`],
      [f.adminProfileId, "Push Admin", `${phonePrefix}02`],
      [f.adminStaffProfileId, "Push Admin Staff", `${phonePrefix}03`],
      [f.adminNoSubProfileId, "Push Admin NoSub", `${phonePrefix}04`],
      [f.activeStaffProfileId, "Push Active Staff", `${phonePrefix}05`],
      [f.inactiveStaffProfileId, "Push Inactive Staff", `${phonePrefix}06`],
      [f.removedStaffProfileId, "Push Removed Staff", `${phonePrefix}07`],
    ];
    for (const [id, displayName, phone] of profiles) {
      await p.query(
        `INSERT INTO "Profile" ("id", "tenantId", "displayName", "phone", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())`,
        [id, f.tenantId, displayName, phone],
      );
    }
    // removedStaffProfileId has no membership: TenantMembership has no status column, so a
    // deactivated member is represented by the row being gone.
    const memberships: Array<[string, "TENANT_ADMIN" | "STAFF"]> = [
      [f.adminProfileId, "TENANT_ADMIN"],
      [f.adminStaffProfileId, "TENANT_ADMIN"],
      [f.adminNoSubProfileId, "TENANT_ADMIN"],
      [f.activeStaffProfileId, "STAFF"],
      [f.inactiveStaffProfileId, "STAFF"],
    ];
    for (const [profileId, role] of memberships) {
      await p.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [`${profileId}-m`, f.tenantId, `${profileId}-s`, profileId, role],
      );
    }
    const staffRows: Array<[string, string, "ACTIVE" | "INACTIVE"]> = [
      [f.staff.active, f.activeStaffProfileId, "ACTIVE"],
      [f.staff.inactive, f.inactiveStaffProfileId, "INACTIVE"],
      [f.staff.adminInactive, f.adminStaffProfileId, "INACTIVE"],
      [f.staff.removed, f.removedStaffProfileId, "ACTIVE"],
    ];
    for (const [id, profileId, status] of staffRows) {
      await p.query(
        `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())`,
        [id, f.tenantId, profileId, status],
      );
    }
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Push Service', 30, 0, true, now(), now())`,
      [f.serviceId, f.tenantId],
    );
    const appointments: Array<[string, string]> = [
      [f.appointments.active, f.staff.active],
      [f.appointments.inactive, f.staff.inactive],
      [f.appointments.adminInactive, f.staff.adminInactive],
      [f.appointments.removed, f.staff.removed],
    ];
    for (const [id, staffId] of appointments) {
      await p.query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day', now() + interval '1 day 30 minutes', now(), now())`,
        [id, f.tenantId, staffId, f.serviceId, f.customerProfileId],
      );
    }
    // WP-10: the "active" appointment's customer opted in to WhatsApp (contact phone = profile phone here).
    await p.query(...publicContactInsert({
      tenantId: f.tenantId, appointmentId: f.appointments.active, tenantName: "Notification Push Tenant",
      displayName: "Push Customer Ayşe", phone: `${phonePrefix}01`, optIn: true,
    }));
    // Every recipient candidate except adminNoSub gets an active subscription via the real repository upsert.
    const subscriptions = createPrismaPushSubscriptionRepository(client());
    for (const profileId of [f.adminProfileId, f.adminStaffProfileId, f.activeStaffProfileId, f.inactiveStaffProfileId, f.removedStaffProfileId]) {
      const k = keys(`${profileId}-${f.tenantId}`);
      await subscriptions.upsert(ctx(f), { profileId, endpoint: endpointOf(f, profileId), p256dh: k.p256dh, auth: k.auth, userAgent: null, at: new Date() });
    }
  }

  function recordingProvider() {
    const sent: Array<{ endpoint: string; payload: string }> = [];
    const provider: WebPushSender = {
      async send(subscription, payload) {
        sent.push({ endpoint: subscription.endpoint, payload });
        return { kind: "ok" };
      },
    };
    return { provider, sent };
  }

  function whatsAppProvider() {
    let counter = 0;
    return {
      channel: "WHATSAPP" as const,
      send: async () => {
        counter += 1;
        return { providerMessageId: `wamid.push-${suffix}-${counter}` };
      },
    };
  }

  const publish = (
    f: Fixture,
    appointmentId: string,
    eventType: "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED",
    provider: WebPushSender,
    withWhatsApp = true,
  ) =>
    createNotificationService({
      repository: createPrismaNotificationRepository(client()),
      provider: withWhatsApp ? whatsAppProvider() : null,
      webPush: { repository: createPrismaPushNotificationRepository(client()), provider },
    }).publish(ctx(f), appointmentId, eventType);

  type DeliveryRow = { recipientProfileId: string; eventType: string; status: string; templateKey: string; providerMessageId: string | null };
  const deliveryRows = async (f: Fixture, appointmentId: string, channel: "WEB_PUSH" | "WHATSAPP"): Promise<DeliveryRow[]> => {
    const result = await db().query(
      `SELECT "recipientProfileId", "eventType"::text AS "eventType", "status"::text AS "status", "templateKey", "providerMessageId"
       FROM "NotificationDelivery"
       WHERE "tenantId" = $1 AND "appointmentId" = $2 AND "channel"::text = $3`,
      [f.tenantId, appointmentId, channel],
    );
    // Sort in JS so the expectation does not depend on the database collation.
    return (result.rows as DeliveryRow[]).sort((left, right) =>
      `${left.eventType}|${left.recipientProfileId}` < `${right.eventType}|${right.recipientProfileId}` ? -1 : 1);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seed(tenantA, "+9055530000");
    await seed(tenantB, "+9055540000");
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const errors: string[] = [];
    for (const f of [tenantA, tenantB]) {
      try {
        // PushSubscription before Profile/Tenant: its FKs are ON DELETE RESTRICT.
        await pool.query('DELETE FROM "PushSubscription" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [f.tenantId]);
        await pool.query('DELETE FROM "AppointmentContact" WHERE "tenantId" = $1', [f.tenantId]);
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

  it("CREATED: one WEB_PUSH row per routed recipient, coexisting with WHATSAPP rows; replay adds nothing", async () => {
    await expect(deliveryRows(tenantA, tenantA.appointments.active, "WHATSAPP")).resolves.toEqual([]);
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantA.appointments.active, "APPOINTMENT_CREATED", provider);

    const pushRows = await deliveryRows(tenantA, tenantA.appointments.active, "WEB_PUSH");
    expect(pushRows.map((row) => row.recipientProfileId)).toEqual(
      sorted([tenantA.activeStaffProfileId, tenantA.adminProfileId, tenantA.adminStaffProfileId]),
    );
    for (const row of pushRows) {
      expect(row).toMatchObject({ eventType: "APPOINTMENT_CREATED", status: "SENT", templateKey: "appointment-created-push", providerMessageId: "webpush:1/1" });
    }
    // adminNoSub has no active subscription: no WEB_PUSH row (ADR-044 §4.2 as amended by the owner).
    expect(pushRows.map((row) => row.recipientProfileId)).not.toContain(tenantA.adminNoSubProfileId);

    // WHATSAPP rows for the same appointment/recipients coexist (the unique key includes channel).
    const whatsAppRows = await deliveryRows(tenantA, tenantA.appointments.active, "WHATSAPP");
    expect(whatsAppRows.map((row) => row.recipientProfileId)).toEqual(expect.arrayContaining([tenantA.activeStaffProfileId, tenantA.adminProfileId]));
    expect(whatsAppRows.every((row) => row.templateKey !== "appointment-created-push")).toBe(true);

    // Payloads carry no customer PII; staff vs admin deep links.
    expect(sent).toHaveLength(3);
    for (const { payload } of sent) {
      expect(payload).not.toContain("Ayşe");
      expect(payload).not.toContain("+905553");
    }
    const urlByEndpoint = new Map(sent.map((entry) => [entry.endpoint, JSON.parse(entry.payload).url as string]));
    expect(urlByEndpoint.get(endpointOf(tenantA, tenantA.activeStaffProfileId))).toBe("/staff/appointments");
    expect(urlByEndpoint.get(sharedEndpoint)).toBe("/admin/calendar");

    // Replay: no duplicate rows and no resend on either channel.
    const replay = recordingProvider();
    await publish(tenantA, tenantA.appointments.active, "APPOINTMENT_CREATED", replay.provider);
    expect(replay.sent).toEqual([]);
    await expect(deliveryRows(tenantA, tenantA.appointments.active, "WEB_PUSH")).resolves.toEqual(pushRows);
    await expect(deliveryRows(tenantA, tenantA.appointments.active, "WHATSAPP")).resolves.toEqual(whatsAppRows);
  });

  it("INACTIVE assigned staff with an active subscription gets no WEB_PUSH row; admins still do", async () => {
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantA.appointments.inactive, "APPOINTMENT_CREATED", provider, false);
    const recipients = (await deliveryRows(tenantA, tenantA.appointments.inactive, "WEB_PUSH")).map((row) => row.recipientProfileId);
    expect(recipients).toEqual(sorted([tenantA.adminProfileId, tenantA.adminStaffProfileId]));
    expect(sent.map((entry) => entry.endpoint)).not.toContain(endpointOf(tenantA, tenantA.inactiveStaffProfileId));
  });

  it("admin wins over their own INACTIVE Staff row: exactly one admin push", async () => {
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantA.appointments.adminInactive, "APPOINTMENT_CREATED", provider, false);
    const rows = await deliveryRows(tenantA, tenantA.appointments.adminInactive, "WEB_PUSH");
    expect(rows.filter((row) => row.recipientProfileId === tenantA.adminStaffProfileId)).toHaveLength(1);
    const adminStaffPayloads = sent.filter((entry) => entry.endpoint === endpointOf(tenantA, tenantA.adminStaffProfileId));
    expect(adminStaffPayloads).toHaveLength(1);
    expect(JSON.parse(adminStaffPayloads[0].payload).url).toBe("/admin/calendar");
  });

  it("assigned staff whose membership was removed gets no WEB_PUSH row", async () => {
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantA.appointments.removed, "APPOINTMENT_CREATED", provider, false);
    const recipients = (await deliveryRows(tenantA, tenantA.appointments.removed, "WEB_PUSH")).map((row) => row.recipientProfileId);
    expect(recipients).toEqual(sorted([tenantA.adminProfileId, tenantA.adminStaffProfileId]));
    expect(sent.map((entry) => entry.endpoint)).not.toContain(endpointOf(tenantA, tenantA.removedStaffProfileId));
  });

  it("routing is tenant-isolated: Tenant B's admins/subscriptions never get rows for Tenant A appointments", async () => {
    const tenantBRows = await db().query('SELECT count(*)::int AS count FROM "NotificationDelivery" WHERE "tenantId" = $1', [tenantB.tenantId]);
    expect(tenantBRows.rows[0].count).toBe(0);
    const foreign = await db().query(
      `SELECT count(*)::int AS count FROM "NotificationDelivery" WHERE "tenantId" = $1 AND "recipientProfileId" = ANY($2::text[])`,
      [tenantA.tenantId, [tenantB.adminProfileId, tenantB.adminStaffProfileId, tenantB.activeStaffProfileId]],
    );
    expect(foreign.rows[0].count).toBe(0);
    // Tenant A's context cannot route Tenant B's appointment at all.
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantB.appointments.active, "APPOINTMENT_CREATED", provider, false);
    expect(sent).toEqual([]);
    await expect(deliveryRows(tenantB, tenantB.appointments.active, "WEB_PUSH")).resolves.toEqual([]);
  });

  it("CONFIRMED (e.g. createOnBehalf notifyCustomer) never creates WEB_PUSH rows; WHATSAPP still works", async () => {
    const { provider, sent } = recordingProvider();
    await publish(tenantA, tenantA.appointments.active, "APPOINTMENT_CONFIRMED", provider);
    expect(sent).toEqual([]);
    const pushRows = await deliveryRows(tenantA, tenantA.appointments.active, "WEB_PUSH");
    expect(pushRows.filter((row) => row.eventType === "APPOINTMENT_CONFIRMED")).toEqual([]);
    const whatsApp = await deliveryRows(tenantA, tenantA.appointments.active, "WHATSAPP");
    expect(whatsApp.filter((row) => row.eventType === "APPOINTMENT_CONFIRMED")).toEqual([
      expect.objectContaining({ recipientProfileId: tenantA.customerProfileId, status: "SENT" }),
    ]);
  });

  it("a 410 from the push service revokes that tenant's subscriptions and marks deliveries FAILED; the other tenant's same endpoint is untouched", async () => {
    const goneProvider: WebPushSender = { send: async () => ({ kind: "gone" }) };
    await publish(tenantB, tenantB.appointments.active, "APPOINTMENT_CREATED", goneProvider, false);
    const rows = await deliveryRows(tenantB, tenantB.appointments.active, "WEB_PUSH");
    expect(rows.map((row) => row.recipientProfileId)).toEqual(
      sorted([tenantB.activeStaffProfileId, tenantB.adminProfileId, tenantB.adminStaffProfileId]),
    );
    for (const row of rows) expect(row).toMatchObject({ status: "FAILED" });
    const subs = await db().query(
      `SELECT "revokedAt" FROM "PushSubscription" WHERE "tenantId" = $1 AND "profileId" = ANY($2::text[])`,
      [tenantB.tenantId, rows.map((row) => row.recipientProfileId)],
    );
    expect(subs.rows).toHaveLength(3);
    expect(subs.rows.every((row) => row.revokedAt !== null)).toBe(true);
    const shared = await db().query(`SELECT "revokedAt" FROM "PushSubscription" WHERE "tenantId" = $1 AND "endpoint" = $2`, [tenantA.tenantId, sharedEndpoint]);
    expect(shared.rows).toEqual([{ revokedAt: null }]);
  });
});
