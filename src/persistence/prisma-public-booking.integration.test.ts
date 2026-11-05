import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { localWallTimeToUtc } from "../domain/availability";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { CUSTOMER_NOTICE, WHATSAPP_OPTIN } from "../domain/legal-notice";
import { TENANT_LEGAL_COLUMNS_SQL, TENANT_LEGAL_VALUES, shownLegalHashes } from "../test/legal-fixtures";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type TenantFixture = {
  tenantId: string;
  name: string;
  slug: string;
  staffProfileId: string;
  staffId: string;
  serviceId: string;
  workingHoursId: string;
};

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function makeFixture(label: string): TenantFixture {
  const suffix = randomUUID();
  return {
    tenantId: `public-booking-${label}-${suffix}`,
    name: `Public Booking ${label}`,
    slug: `public-booking-${label}-${suffix}`,
    staffProfileId: `public-booking-staff-profile-${label}-${suffix}`,
    staffId: `public-booking-staff-${label}-${suffix}`,
    serviceId: `public-booking-service-${label}-${suffix}`,
    workingHoursId: `public-booking-hours-${label}-${suffix}`,
  };
}

describeDatabase("Prisma public booking tenant isolation integration", () => {
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");
  // WP-07: a third tenant that is INACTIVE (status toggled after seeding).
  const tenantInactive = makeFixture("inactive");
  const bookingDate = nextMondayIso();
  const startAt = localWallTimeToUtc(bookingDate, 10 * 60, "Europe/Istanbul");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const seedTenant = async (fixture: TenantFixture, label: string) => {
    if (!pool) throw new Error("Database pool was not initialized");

    // WP-10: KVKK legal fields set, otherwise the booking tx returns tenant_legal_incomplete.
    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", ${TENANT_LEGAL_COLUMNS_SQL}, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', $4, $5, $6, now(), now())`,
      [fixture.tenantId, fixture.slug, fixture.name, ...TENANT_LEGAL_VALUES],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [fixture.staffProfileId, fixture.tenantId, `Staff ${label}`],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
    await pool.query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [fixture.workingHoursId, fixture.tenantId],
    );
  };

  const cleanupTenant = async (fixture: TenantFixture) => {
    if (!pool) return;
    await pool.query('DELETE FROM "CustomerNote" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "AppointmentAccessToken" WHERE "tenantId" = $1', [fixture.tenantId]);
    // WP-10: contact snapshot before Appointment (composite FK is ON DELETE RESTRICT).
    await pool.query('DELETE FROM "AppointmentContact" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "WorkingHours" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  const createRepository = () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    return createPrismaPublicBookingRepository(prisma as unknown as PrismaTenantClient);
  };

  /** `context` = tenant whose booking form was shown (notice hash is rendered from its fields). */
  const bookingInput = (serviceId: string, staffId: string, email: string, context: TenantFixture) => ({
    serviceId,
    staffId,
    startAt,
    displayName: "Integration Customer",
    email,
    phone: null,
    accessTokenHash: generateAppointmentAccessToken().tokenHash,
    ...shownLegalHashes(context.name),
  });

  const expectNoCustomerOrAppointment = async (tenantId: string, email: string) => {
    if (!pool) throw new Error("Database pool was not initialized");
    const profiles = await pool.query(
      'SELECT "id" FROM "Profile" WHERE "tenantId" = $1 AND "email" = $2',
      [tenantId, email],
    );
    expect(profiles.rows).toHaveLength(0);
    const appointments = await pool.query(
      `SELECT "id" FROM "Appointment"
       WHERE "tenantId" = $1
         AND "customerProfileId" IN (
           SELECT "id" FROM "Profile" WHERE "tenantId" = $1 AND "email" = $2
         )`,
      [tenantId, email],
    );
    expect(appointments.rows).toHaveLength(0);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
    await seedTenant(tenantInactive, "Inactive");
    await pool.query(`UPDATE "Tenant" SET "status" = 'INACTIVE' WHERE "id" = $1`, [tenantInactive.tenantId]);
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const cleanupErrors: string[] = [];
    for (const fixture of [tenantA, tenantB, tenantInactive]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    try {
      await prisma.$disconnect();
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

  it("creates a booking with the active tenant's own service and staff", async () => {
    if (!pool) throw new Error("Database pool was not initialized");
    const email = `tenant-a-customer-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA),
    );

    expect(result).toMatchObject({ status: "created" });
    if (typeof result !== "object" || result.status !== "created") {
      throw new Error("Expected a created booking result");
    }

    const persisted = await pool.query(
      `SELECT a."tenantId", a."serviceId", a."staffId", p."email"
       FROM "Appointment" a
       JOIN "Profile" p ON p."tenantId" = a."tenantId" AND p."id" = a."customerProfileId"
       WHERE a."id" = $1`,
      [result.appointmentId],
    );
    expect(persisted.rows).toEqual([{
      tenantId: tenantA.tenantId,
      serviceId: tenantA.serviceId,
      staffId: tenantA.staffId,
      email,
    }]);
  });

  it("rejects Tenant B's service ID in Tenant A context without creating a customer", async () => {
    const email = `cross-service-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantB.serviceId, tenantA.staffId, email, tenantA),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantA.tenantId, email);
  });

  it("rejects Tenant B's staff ID in Tenant A context without creating a customer", async () => {
    const email = `cross-staff-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantA.tenantId as never },
      bookingInput(tenantA.serviceId, tenantB.staffId, email, tenantA),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantA.tenantId, email);
  });

  it("rejects Tenant A's service ID in Tenant B context without creating a customer", async () => {
    const email = `reverse-cross-service-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantB.tenantId as never },
      bookingInput(tenantA.serviceId, tenantB.staffId, email, tenantB),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantB.tenantId, email);
  });

  it("rejects Tenant A's staff ID in Tenant B context without creating a customer", async () => {
    const email = `reverse-cross-staff-${randomUUID()}@example.test`;
    const result = await createRepository().create(
      { tenantId: tenantB.tenantId as never },
      bookingInput(tenantB.serviceId, tenantA.staffId, email, tenantB),
    );

    expect(result).toBe("invalid_resource");
    await expectNoCustomerOrAppointment(tenantB.tenantId, email);
  });

  describe("tenant status gate (WP-07)", () => {
    const countRows = async (tenantId: string) => {
      if (!pool) throw new Error("Database pool was not initialized");
      const result = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "Appointment" WHERE "tenantId" = $1) AS appointments,
           (SELECT count(*)::int FROM "AppointmentAccessToken" WHERE "tenantId" = $1) AS tokens,
           (SELECT count(*)::int FROM "NotificationDelivery" WHERE "tenantId" = $1) AS deliveries`,
        [tenantId],
      );
      return result.rows[0] as { appointments: number; tokens: number; deliveries: number };
    };

    it("returns tenant_inactive for an INACTIVE tenant and inserts no customer, appointment or access token", async () => {
      const email = `inactive-${randomUUID()}@example.test`;
      const before = await countRows(tenantInactive.tenantId);

      const result = await createRepository().create(
        { tenantId: tenantInactive.tenantId as never },
        bookingInput(tenantInactive.serviceId, tenantInactive.staffId, email, tenantInactive),
      );

      expect(result).toBe("tenant_inactive");
      await expectNoCustomerOrAppointment(tenantInactive.tenantId, email);
      await expect(countRows(tenantInactive.tenantId)).resolves.toEqual(before);
    });

    it("keeps Tenant B bookable while another tenant is INACTIVE", async () => {
      const email = `tenant-b-while-inactive-${randomUUID()}@example.test`;
      const result = await createRepository().create(
        { tenantId: tenantB.tenantId as never },
        bookingInput(tenantB.serviceId, tenantB.staffId, email, tenantB),
      );

      expect(result).toMatchObject({ status: "created" });
    });

    it("ACTIVE tenant still creates the appointment and its access token in the same transaction (WP-06 non-regression)", async () => {
      if (!pool) throw new Error("Database pool was not initialized");
      const email = `active-token-${randomUUID()}@example.test`;
      const input = { ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: new Date(startAt.getTime() + 60 * 60_000) };

      const result = await createRepository().create({ tenantId: tenantA.tenantId as never }, input);
      if (typeof result !== "object" || result.status !== "created") {
        throw new Error(`Expected a created booking result, got ${JSON.stringify(result)}`);
      }

      const tokens = await pool.query(
        'SELECT "tenantId", "tokenHash" FROM "AppointmentAccessToken" WHERE "appointmentId" = $1',
        [result.appointmentId],
      );
      expect(tokens.rows).toEqual([{ tenantId: tenantA.tenantId, tokenHash: input.accessTokenHash }]);
    });

    it("books again once the tenant is reactivated", async () => {
      if (!pool) throw new Error("Database pool was not initialized");
      await pool.query(`UPDATE "Tenant" SET "status" = 'ACTIVE' WHERE "id" = $1`, [tenantInactive.tenantId]);
      try {
        const result = await createRepository().create(
          { tenantId: tenantInactive.tenantId as never },
          bookingInput(tenantInactive.serviceId, tenantInactive.staffId, `reactivated-${randomUUID()}@example.test`, tenantInactive),
        );
        expect(result).toMatchObject({ status: "created" });
      } finally {
        await pool.query(`UPDATE "Tenant" SET "status" = 'INACTIVE' WHERE "id" = $1`, [tenantInactive.tenantId]);
      }
    });
  });

  describe("WP-10 KVKK notice record and contact snapshot", () => {
    // Each case uses its own hour so slots never collide with the cases above (10:00 / 11:00).
    const at = (hour: number) => localWallTimeToUtc(bookingDate, hour * 60, "Europe/Istanbul");

    const contactOf = async (appointmentId: string) => {
      if (!pool) throw new Error("Database pool was not initialized");
      const result = await pool.query(
        `SELECT "tenantId", "source"::text AS "source", "displayName", "email", "phone",
                "noticeVersion", "noticeHash", "noticeShownAt" IS NOT NULL AS "noticeShown",
                "whatsappOptIn", "optInVersion", "optInHash", "optInAt" IS NOT NULL AS "optInRecorded",
                "optInRecordedByProfileId", "optOutAt"
         FROM "AppointmentContact" WHERE "appointmentId" = $1`,
        [appointmentId],
      );
      return result.rows;
    };

    const countRows = async (tenantId: string) => {
      if (!pool) throw new Error("Database pool was not initialized");
      const result = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM "Profile" WHERE "tenantId" = $1) AS profiles,
           (SELECT count(*)::int FROM "Appointment" WHERE "tenantId" = $1) AS appointments,
           (SELECT count(*)::int FROM "AppointmentAccessToken" WHERE "tenantId" = $1) AS tokens,
           (SELECT count(*)::int FROM "AppointmentContact" WHERE "tenantId" = $1) AS contacts`,
        [tenantId],
      );
      return result.rows[0] as { profiles: number; appointments: number; tokens: number; contacts: number };
    };

    it("writes the appointment, its access token and the PUBLIC_FORM contact (current notice hash) in one transaction", async () => {
      if (!pool) throw new Error("Database pool was not initialized");
      const email = `contact-${randomUUID()}@example.test`;
      const input = { ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: at(12) };
      const result = await createRepository().create({ tenantId: tenantA.tenantId as never }, input);
      if (typeof result !== "object" || result.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(result)}`);

      await expect(contactOf(result.appointmentId)).resolves.toEqual([{
        tenantId: tenantA.tenantId, source: "PUBLIC_FORM", displayName: "Integration Customer", email, phone: null,
        noticeVersion: CUSTOMER_NOTICE.version, noticeHash: input.shownNoticeHash, noticeShown: true,
        whatsappOptIn: false, optInVersion: null, optInHash: null, optInRecorded: false,
        optInRecordedByProfileId: null, optOutAt: null,
      }]);
      const tokens = await pool.query('SELECT "tokenHash" FROM "AppointmentAccessToken" WHERE "appointmentId" = $1', [result.appointmentId]);
      expect(tokens.rows).toEqual([{ tokenHash: input.accessTokenHash }]);
    });

    it("records the opt-in text version/hash with the entered phone when the customer opted in", async () => {
      const email = `contact-optin-${randomUUID()}@example.test`;
      const input = {
        ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: at(13),
        phone: "+905551230001", ...shownLegalHashes(tenantA.name, { optIn: true }),
      };
      const result = await createRepository().create({ tenantId: tenantA.tenantId as never }, input);
      if (typeof result !== "object" || result.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(result)}`);
      await expect(contactOf(result.appointmentId)).resolves.toEqual([expect.objectContaining({
        phone: "+905551230001", whatsappOptIn: true, optInVersion: WHATSAPP_OPTIN.version,
        optInHash: input.shownOptInHash, optInRecorded: true, optInRecordedByProfileId: null, optOutAt: null,
      })]);
    });

    it("rolls back appointment, profile and token when the contact insert fails (same transaction)", async () => {
      const email = `contact-rollback-${randomUUID()}@example.test`;
      const before = await countRows(tenantA.tenantId);
      // 161 chars: Profile.displayName is unbounded, AppointmentContact.displayName is VARCHAR(160),
      // so the failure happens on the LAST insert of the booking transaction.
      const input = { ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: at(14), displayName: "x".repeat(161) };
      await expect(createRepository().create({ tenantId: tenantA.tenantId as never }, input)).resolves.toBe("persistence_failure");
      await expectNoCustomerOrAppointment(tenantA.tenantId, email);
      await expect(countRows(tenantA.tenantId)).resolves.toEqual(before);
    });

    it("existing email + new phone: snapshot keeps the new phone, Profile.phone/displayName are never updated", async () => {
      if (!pool) throw new Error("Database pool was not initialized");
      const email = `contact-existing-${randomUUID()}@example.test`;
      const first = await createRepository().create({ tenantId: tenantA.tenantId as never }, {
        ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: at(15), phone: "+905551230010",
      });
      if (typeof first !== "object" || first.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(first)}`);
      const second = await createRepository().create({ tenantId: tenantA.tenantId as never }, {
        ...bookingInput(tenantA.serviceId, tenantA.staffId, email, tenantA), startAt: at(16),
        displayName: "Someone Else", phone: "+905551230099", ...shownLegalHashes(tenantA.name, { optIn: true }),
      });
      if (typeof second !== "object" || second.status !== "created") throw new Error(`Expected created, got ${JSON.stringify(second)}`);

      const profiles = await pool.query('SELECT "displayName", "phone" FROM "Profile" WHERE "tenantId" = $1 AND "email" = $2', [tenantA.tenantId, email]);
      expect(profiles.rows).toEqual([{ displayName: "Integration Customer", phone: "+905551230010" }]);
      await expect(contactOf(second.appointmentId)).resolves.toEqual([expect.objectContaining({
        displayName: "Someone Else", phone: "+905551230099", whatsappOptIn: true,
      })]);
      await expect(contactOf(first.appointmentId)).resolves.toEqual([expect.objectContaining({ phone: "+905551230010", whatsappOptIn: false })]);
    });

    it("returns tenant_legal_incomplete and writes nothing when any legal field is missing", async () => {
      if (!pool) throw new Error("Database pool was not initialized");
      for (const column of ["legalName", "legalAddress", "kvkkContactEmail"] as const) {
        const original = await pool.query(`SELECT "${column}" AS value FROM "Tenant" WHERE "id" = $1`, [tenantB.tenantId]);
        await pool.query(`UPDATE "Tenant" SET "${column}" = NULL WHERE "id" = $1`, [tenantB.tenantId]);
        try {
          const before = await countRows(tenantB.tenantId);
          const email = `legal-incomplete-${randomUUID()}@example.test`;
          await expect(createRepository().create(
            { tenantId: tenantB.tenantId as never },
            { ...bookingInput(tenantB.serviceId, tenantB.staffId, email, tenantB), startAt: at(12) },
          )).resolves.toBe("tenant_legal_incomplete");
          await expectNoCustomerOrAppointment(tenantB.tenantId, email);
          await expect(countRows(tenantB.tenantId)).resolves.toEqual(before);
        } finally {
          await pool.query(`UPDATE "Tenant" SET "${column}" = $2 WHERE "id" = $1`, [tenantB.tenantId, original.rows[0].value]);
        }
      }
    });

    it.each(["legalName", "legalAddress", "kvkkContactEmail"] as const)(
      "returns notice_stale with no writes when %s changed after the shown hash was computed",
      async (column) => {
        if (!pool) throw new Error("Database pool was not initialized");
        const shown = bookingInput(tenantB.serviceId, tenantB.staffId, `stale-${column}-${randomUUID()}@example.test`, tenantB);
        const original = await pool.query(`SELECT "${column}" AS value FROM "Tenant" WHERE "id" = $1`, [tenantB.tenantId]);
        const changed = column === "kvkkContactEmail" ? "yeni-kvkk@example.test" : `${original.rows[0].value} Yeni`;
        await pool.query(`UPDATE "Tenant" SET "${column}" = $2 WHERE "id" = $1`, [tenantB.tenantId, changed]);
        try {
          const before = await countRows(tenantB.tenantId);
          await expect(createRepository().create({ tenantId: tenantB.tenantId as never }, { ...shown, startAt: at(13) }))
            .resolves.toBe("notice_stale");
          await expectNoCustomerOrAppointment(tenantB.tenantId, shown.email);
          await expect(countRows(tenantB.tenantId)).resolves.toEqual(before);
        } finally {
          await pool.query(`UPDATE "Tenant" SET "${column}" = $2 WHERE "id" = $1`, [tenantB.tenantId, original.rows[0].value]);
        }
      },
    );

    it("returns notice_stale with no writes when the opt-in hash is not the current one", async () => {
      const email = `stale-optin-${randomUUID()}@example.test`;
      const before = await countRows(tenantB.tenantId);
      await expect(createRepository().create({ tenantId: tenantB.tenantId as never }, {
        ...bookingInput(tenantB.serviceId, tenantB.staffId, email, tenantB), startAt: at(14), phone: "+905551230020",
        // Opt-in text rendered for another salon name (Tenant A) is not what Tenant B shows.
        whatsappOptIn: true, shownOptInHash: shownLegalHashes(tenantA.name, { optIn: true }).shownOptInHash,
      })).resolves.toBe("notice_stale");
      await expect(countRows(tenantB.tenantId)).resolves.toEqual(before);
    });

    it("rejects Tenant A's notice hash in Tenant B context (hash is tenant-specific)", async () => {
      const email = `cross-notice-${randomUUID()}@example.test`;
      await expect(createRepository().create(
        { tenantId: tenantB.tenantId as never },
        { ...bookingInput(tenantB.serviceId, tenantB.staffId, email, tenantA), startAt: at(15) },
      )).resolves.toBe("notice_stale");
      await expectNoCustomerOrAppointment(tenantB.tenantId, email);
    });
  });
});
