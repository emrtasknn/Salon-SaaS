import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createBookingEngine } from "../application/booking-engine";
import { createCustomerAppointmentStatus } from "../application/customer-appointment-status";
import { createNotificationService } from "../application/notification-service";
import { createPublicBooking } from "../application/public-booking";
import { createNoopStatusLinkRateLimiter } from "../application/status-link-rate-limit";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";
import { hashAppointmentAccessToken } from "../domain/appointment-access-token";
import { STAFF_VERBAL_OPTIN, staffVerbalOptInHash } from "../domain/legal-notice";
import type { NotificationProvider } from "../infrastructure/notifications";
import { TENANT_LEGAL_COLUMNS_SQL, TENANT_LEGAL_VALUES, publicContactInsert, publicLegalInput } from "../test/legal-fixtures";
import { createPrismaAppointmentAccessTokenRepository } from "./prisma-appointment-access-token";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import { createPrismaNotificationRepository } from "./prisma-notification";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import type { PrismaTenantClient } from "./prisma-tenant-context";

// WP-10: end-to-end WhatsApp consent routing on real PostgreSQL: public booking contact snapshot ->
// customer WhatsApp only to the snapshot phone with an active opt-in; status-link opt-out; staff
// verbal opt-in. CI only (isolated PostgreSQL 17); skipped without DATABASE_URL. Never run against a shared DB.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TZ = "Europe/Istanbul";

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function makeFixture(label: "A" | "B", phonePrefix: string) {
  const id = (name: string) => `consent-${name}-${label.toLowerCase()}-${randomUUID()}`;
  return {
    label,
    name: `Consent Salon ${label}`,
    tenantId: id("tenant"),
    slug: id("tenant"),
    staffProfileId: id("staff-profile"),
    staffPhone: `${phonePrefix}01`,
    customerProfileId: id("customer"),
    customerPhone: `${phonePrefix}02`,
    noPhoneCustomerProfileId: id("customer-nophone"),
    staffId: id("staff"),
    serviceId: id("service"),
    workingHoursId: id("hours"),
  };
}
type Fixture = ReturnType<typeof makeFixture>;

describeDatabase("WhatsApp consent routing integration (WP-10)", () => {
  const tenantA = makeFixture("A", "+9055580000");
  const tenantB = makeFixture("B", "+9055590000");
  const monday = addDaysToDateIso(nextMondayIso(), 7);
  // One slot per booking so cases never collide (Monday 09:00-18:00, 30-minute service).
  let nextSlot = 9 * 60;
  const slot = () => {
    const minute = nextSlot;
    nextSlot += 30;
    if (nextSlot > 18 * 60) throw new Error("out of test slots");
    return localWallTimeToUtc(monday, minute, TZ);
  };

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };
  const client = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return prisma as unknown as PrismaTenantClient;
  };
  const ctx = (f: Fixture) => ({ tenantId: f.tenantId as never });

  const sent: Array<{ to: string; templateKey: string }> = [];
  const whatsApp: NotificationProvider = {
    channel: "WHATSAPP",
    send: async (input) => {
      sent.push({ to: input.to, templateKey: input.templateKey });
      return { providerMessageId: `wamid.consent-${randomUUID()}` };
    },
  };
  const publish = (f: Fixture, appointmentId: string, eventType: "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED") =>
    createNotificationService({ repository: createPrismaNotificationRepository(client()), provider: whatsApp })
      .publish(ctx(f), appointmentId, eventType);

  const bookPublic = async (f: Fixture, input: Readonly<{ email: string; phone: string | null; optIn: boolean; displayName?: string }>) => {
    const result = await createPublicBooking(createPrismaPublicBookingRepository(client())).create(ctx(f), {
      serviceId: f.serviceId, staffId: f.staffId, startAt: slot(),
      displayName: input.displayName ?? "Consent Customer", email: input.email, phone: input.phone,
      ...publicLegalInput(f.name, { optIn: input.optIn }),
    });
    if (result.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(result)}`);
    return result;
  };

  const statusService = () => {
    const salons = createPrismaPublicSalonRepository(client());
    return createCustomerAppointmentStatus({
      resolveTenantBySlug: (slug) => salons.resolveBySlug(slug),
      repository: createPrismaAppointmentAccessTokenRepository(client()),
      limiter: createNoopStatusLinkRateLimiter(),
    });
  };

  const engine = () => createBookingEngine({
    repository: createPrismaBookingRepository(client()),
    // Admin scope stub: authorization is unit-tested; this suite targets persistence + routing.
    authorizer: {
      authorize: async () => false,
      authorizeStaffDecision: async () => false,
      resolveCreateScope: async () => ({ kind: "admin" as const }),
    },
  });

  type DeliveryRow = { recipientProfileId: string; eventType: string; templateKey: string };
  const whatsAppRows = async (f: Fixture, appointmentId: string): Promise<DeliveryRow[]> => {
    const result = await db().query(
      `SELECT "recipientProfileId", "eventType"::text AS "eventType", "templateKey"
       FROM "NotificationDelivery" WHERE "tenantId" = $1 AND "appointmentId" = $2 AND "channel"::text = 'WHATSAPP'`,
      [f.tenantId, appointmentId],
    );
    return (result.rows as DeliveryRow[]).sort((l, r) => (`${l.eventType}|${l.templateKey}` < `${r.eventType}|${r.templateKey}` ? -1 : 1));
  };
  const contactOf = async (appointmentId: string) => (await db().query(
    `SELECT "tenantId", "source"::text AS "source", "phone", "whatsappOptIn", "optInVersion", "optInHash",
            "optInRecordedByProfileId", "optOutAt" IS NOT NULL AS "optedOut"
     FROM "AppointmentContact" WHERE "appointmentId" = $1`, [appointmentId])).rows;
  const customerProfileOf = async (appointmentId: string) => (await db().query(
    `SELECT p."id", p."displayName", p."phone" FROM "Appointment" a
     JOIN "Profile" p ON p."tenantId" = a."tenantId" AND p."id" = a."customerProfileId" WHERE a."id" = $1`, [appointmentId])).rows[0];

  const seedTenant = async (f: Fixture) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", ${TENANT_LEGAL_COLUMNS_SQL}, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, '${TZ}', $4, $5, $6, now(), now())`,
      [f.tenantId, f.slug, f.name, ...TENANT_LEGAL_VALUES],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "email", "phone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NULL, $4, now(), now()),
              ($5, $2, $6, $7, $8, now(), now()),
              ($9, $2, $10, NULL, NULL, now(), now())`,
      [
        f.staffProfileId, f.tenantId, `Staff ${f.label}`, f.staffPhone,
        f.customerProfileId, `Known Customer ${f.label}`, `known-${f.tenantId}@example.test`, f.customerPhone,
        f.noPhoneCustomerProfileId, `No Phone Customer ${f.label}`,
      ],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [f.staffId, f.tenantId, f.staffProfileId],
    );
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [f.serviceId, f.tenantId, `Service ${f.label}`],
    );
    await p.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [f.workingHoursId, f.tenantId],
    );
  };

  const cleanupTenant = async (f: Fixture) => {
    const p = db();
    await p.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [f.tenantId]);
    // Contact before Appointment/Profile: composite FKs are ON DELETE RESTRICT.
    await p.query('DELETE FROM "AppointmentContact" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [f.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [f.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA);
    await seedTenant(tenantB);
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    for (const f of [tenantA, tenantB]) {
      try {
        await cleanupTenant(f);
      } catch (error) {
        errors.push(`cleanup failed for ${f.tenantId}: ${String(error)}`);
      }
    }
    try {
      await prisma?.$disconnect();
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

  describe("notification recipients", () => {
    it("no contact row (legacy appointment): no customer delivery row, staff still notified", async () => {
      const appointmentId = `consent-legacy-${randomUUID()}`;
      await db().query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6::timestamptz AT TIME ZONE 'UTC', ($6::timestamptz + interval '30 minutes') AT TIME ZONE 'UTC', now(), now())`,
        [appointmentId, tenantA.tenantId, tenantA.staffId, tenantA.serviceId, tenantA.customerProfileId, slot().toISOString()],
      );
      sent.length = 0;
      await publish(tenantA, appointmentId, "APPOINTMENT_CREATED");
      await publish(tenantA, appointmentId, "APPOINTMENT_CONFIRMED");

      await expect(whatsAppRows(tenantA, appointmentId)).resolves.toEqual([
        { recipientProfileId: tenantA.staffProfileId, eventType: "APPOINTMENT_CREATED", templateKey: "appointment-created-staff" },
      ]);
      // Profile.phone is never a fallback for the customer.
      expect(sent.map((s) => s.to)).toEqual([tenantA.staffPhone]);
    });

    it("public booking without opt-in: no customer delivery row, staff still notified", async () => {
      const booked = await bookPublic(tenantA, { email: `no-optin-${randomUUID()}@example.test`, phone: "+905558111111", optIn: false });
      sent.length = 0;
      await publish(tenantA, booked.appointmentId, "APPOINTMENT_CREATED");
      await publish(tenantA, booked.appointmentId, "APPOINTMENT_CONFIRMED");

      const rows = await whatsAppRows(tenantA, booked.appointmentId);
      expect(rows.map((r) => r.templateKey)).toEqual(["appointment-created-staff"]);
      expect(sent.map((s) => s.to)).toEqual([tenantA.staffPhone]);
      expect(sent.map((s) => s.to)).not.toContain("+905558111111");
    });

    it("existing email + new phone with opt-in: customer delivery goes to the NEW phone and Profile.phone is unchanged", async () => {
      const email = `known-${tenantA.tenantId}@example.test`; // the seeded known customer's email
      const booked = await bookPublic(tenantA, { email, phone: "+905558222222", optIn: true, displayName: "Impostor Name" });
      await expect(customerProfileOf(booked.appointmentId)).resolves.toEqual({
        id: tenantA.customerProfileId, displayName: `Known Customer ${tenantA.label}`, phone: tenantA.customerPhone,
      });

      sent.length = 0;
      await publish(tenantA, booked.appointmentId, "APPOINTMENT_CREATED");
      await expect(whatsAppRows(tenantA, booked.appointmentId)).resolves.toEqual([
        { recipientProfileId: tenantA.customerProfileId, eventType: "APPOINTMENT_CREATED", templateKey: "appointment-created-customer" },
        { recipientProfileId: tenantA.staffProfileId, eventType: "APPOINTMENT_CREATED", templateKey: "appointment-created-staff" },
      ]);
      const customerSends = sent.filter((s) => s.templateKey === "appointment-created-customer");
      expect(customerSends).toEqual([{ to: "+905558222222", templateKey: "appointment-created-customer" }]);
      expect(sent.map((s) => s.to)).not.toContain(tenantA.customerPhone);
    });
  });

  describe("status-link WhatsApp opt-out", () => {
    it("sets optOutAt only on that tenant's row; repeat is idempotent; later events skip the customer", async () => {
      const a = await bookPublic(tenantA, { email: `optout-a-${randomUUID()}@example.test`, phone: "+905558333333", optIn: true });
      const b = await bookPublic(tenantB, { email: `optout-b-${randomUUID()}@example.test`, phone: "+905558444444", optIn: true });
      sent.length = 0;
      await publish(tenantA, a.appointmentId, "APPOINTMENT_CREATED");
      expect(sent.filter((s) => s.to === "+905558333333")).toHaveLength(1);

      // Tenant A's token under Tenant B's slug resolves nothing and changes nothing.
      await expect(statusService().stopWhatsApp(tenantB.slug, a.accessToken)).resolves.toEqual({ status: "not_found" });
      const aTokenHash = hashAppointmentAccessToken(a.accessToken);
      if (!aTokenHash) throw new Error("token hash missing");
      await expect(createPrismaAppointmentAccessTokenRepository(client())
        .stopWhatsAppByTokenHash(ctx(tenantB), aTokenHash, new Date())).resolves.toBe("not_found");
      await expect(contactOf(a.appointmentId)).resolves.toEqual([expect.objectContaining({ optedOut: false })]);

      await expect(statusService().stopWhatsApp(tenantA.slug, a.accessToken)).resolves.toEqual({ status: "stopped" });
      await expect(statusService().stopWhatsApp(tenantA.slug, a.accessToken)).resolves.toEqual({ status: "already_stopped" });
      await expect(contactOf(a.appointmentId)).resolves.toEqual([expect.objectContaining({ tenantId: tenantA.tenantId, whatsappOptIn: true, optedOut: true })]);
      await expect(contactOf(b.appointmentId)).resolves.toEqual([expect.objectContaining({ tenantId: tenantB.tenantId, whatsappOptIn: true, optedOut: false })]);
      await expect(statusService().view(tenantA.slug, a.accessToken)).resolves.toMatchObject({ status: "ok", whatsapp: "OPTED_OUT" });
      await expect(statusService().view(tenantB.slug, b.accessToken)).resolves.toMatchObject({ status: "ok", whatsapp: "OPTED_IN" });

      sent.length = 0;
      await publish(tenantA, a.appointmentId, "APPOINTMENT_CONFIRMED");
      expect(sent).toEqual([]);
      const rows = await whatsAppRows(tenantA, a.appointmentId);
      expect(rows.filter((r) => r.eventType === "APPOINTMENT_CONFIRMED")).toEqual([]);

      // Tenant B's opted-in customer is still notified.
      await publish(tenantB, b.appointmentId, "APPOINTMENT_CONFIRMED");
      expect(sent).toEqual([{ to: "+905558444444", templateKey: "appointment-confirmed-customer" }]);
    });

    it("returns not_opted_in for a booking without opt-in and writes nothing", async () => {
      const booked = await bookPublic(tenantA, { email: `optout-none-${randomUUID()}@example.test`, phone: null, optIn: false });
      await expect(statusService().stopWhatsApp(tenantA.slug, booked.accessToken)).resolves.toEqual({ status: "not_opted_in" });
      await expect(contactOf(booked.appointmentId)).resolves.toEqual([expect.objectContaining({ whatsappOptIn: false, optedOut: false })]);
    });

    it("returns not_found for an unknown token", async () => {
      await expect(statusService().stopWhatsApp(tenantA.slug, "x".repeat(43))).resolves.toEqual({ status: "not_found" });
    });

    it("a seeded already-opted-out row stays opted out (no customer delivery)", async () => {
      const appointmentId = `consent-seeded-optout-${randomUUID()}`;
      await db().query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6::timestamptz AT TIME ZONE 'UTC', ($6::timestamptz + interval '30 minutes') AT TIME ZONE 'UTC', now(), now())`,
        [appointmentId, tenantB.tenantId, tenantB.staffId, tenantB.serviceId, tenantB.customerProfileId, slot().toISOString()],
      );
      await db().query(...publicContactInsert({
        tenantId: tenantB.tenantId, appointmentId, tenantName: tenantB.name, displayName: "Seeded",
        phone: "+905558555555", optIn: true, optedOut: true,
      }));
      sent.length = 0;
      await publish(tenantB, appointmentId, "APPOINTMENT_CONFIRMED");
      expect(sent).toEqual([]);
      await expect(whatsAppRows(tenantB, appointmentId)).resolves.toEqual([]);
    });
  });

  describe("staff/admin verbal opt-in", () => {
    it("records STAFF source, the verbal opt-in text and the acting profile as recorder; customer is notified on the snapshot phone", async () => {
      const identity = createAuthenticatedIdentity("consent-subject", tenantA.staffProfileId);
      const result = await engine().createOnBehalf(identity, ctx(tenantA), {
        serviceId: tenantA.serviceId, staffId: tenantA.staffId, startAt: slot(),
        customer: { kind: "existing", profileId: tenantA.customerProfileId }, whatsappVerbalOptIn: true,
      });
      if (result.status !== "CREATED") throw new Error(`Expected CREATED, got ${JSON.stringify(result)}`);
      expect(result.customerWhatsAppOptIn).toBe(true);
      await expect(contactOf(result.appointmentId)).resolves.toEqual([{
        tenantId: tenantA.tenantId, source: "STAFF", phone: tenantA.customerPhone, whatsappOptIn: true,
        optInVersion: STAFF_VERBAL_OPTIN.version, optInHash: staffVerbalOptInHash(),
        optInRecordedByProfileId: tenantA.staffProfileId, optedOut: false,
      }]);

      sent.length = 0;
      await publish(tenantA, result.appointmentId, "APPOINTMENT_CONFIRMED");
      expect(sent).toEqual([{ to: tenantA.customerPhone, templateKey: "appointment-confirmed-customer" }]);
    });

    it("without the checkbox the STAFF snapshot has no opt-in and the customer gets no WhatsApp", async () => {
      const identity = createAuthenticatedIdentity("consent-subject", tenantA.staffProfileId);
      const result = await engine().createOnBehalf(identity, ctx(tenantA), {
        serviceId: tenantA.serviceId, staffId: tenantA.staffId, startAt: slot(),
        customer: { kind: "existing", profileId: tenantA.customerProfileId },
      });
      if (result.status !== "CREATED") throw new Error(`Expected CREATED, got ${JSON.stringify(result)}`);
      await expect(contactOf(result.appointmentId)).resolves.toEqual([expect.objectContaining({
        source: "STAFF", whatsappOptIn: false, optInRecordedByProfileId: null,
      })]);
      sent.length = 0;
      await publish(tenantA, result.appointmentId, "APPOINTMENT_CONFIRMED");
      expect(sent).toEqual([]);
    });

    it("verbal opt-in for a customer without a phone -> OPT_IN_REQUIRES_PHONE and nothing is written", async () => {
      const count = async () => (await db().query(
        `SELECT (SELECT count(*)::int FROM "Appointment" WHERE "tenantId" = $1) AS a,
                (SELECT count(*)::int FROM "AppointmentContact" WHERE "tenantId" = $1) AS c,
                (SELECT count(*)::int FROM "AppointmentAccessToken" WHERE "tenantId" = $1) AS t`, [tenantA.tenantId])).rows[0];
      const before = await count();
      const identity = createAuthenticatedIdentity("consent-subject", tenantA.staffProfileId);
      await expect(engine().createOnBehalf(identity, ctx(tenantA), {
        serviceId: tenantA.serviceId, staffId: tenantA.staffId, startAt: slot(),
        customer: { kind: "existing", profileId: tenantA.noPhoneCustomerProfileId }, whatsappVerbalOptIn: true,
      })).resolves.toMatchObject({ status: "OPT_IN_REQUIRES_PHONE" });
      await expect(count()).resolves.toEqual(before);
    });
  });
});
