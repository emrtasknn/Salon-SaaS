import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";
import { DELETED_CUSTOMER_NAME } from "../domain/deletion";
import { createPublicBooking } from "../application/public-booking";
import { createPrismaAppointmentDeletionRepository } from "./prisma-appointment-deletion";
import { createPrismaStaffDeletionRepository } from "./prisma-staff-deletion";
import { createPrismaServiceDeletionRepository } from "./prisma-service-deletion";
import { createPrismaCustomerDeletionRepository } from "./prisma-customer-deletion";
import { createPrismaPlatformTenantRepository, type PrismaPlatformTenantClient } from "./prisma-platform-tenants";
import { createPrismaMembershipReader } from "./prisma-membership-reader";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import { createPrismaCalendarCrmRepository } from "./prisma-calendar-crm";
import { createPrismaStaffRepository } from "./prisma-staff-management";
import { createPrismaServiceRepository } from "./prisma-service-management";
import { createPrismaStaffAppointmentsRepository } from "./prisma-staff-appointments";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import {
  TENANT_LEGAL_COLUMNS_SQL,
  TENANT_LEGAL_VALUES,
  publicContactInsert,
  publicLegalInput,
} from "../test/legal-fixtures";

// Soft-delete / erasure integration suite. CI only (isolated PostgreSQL 17); skipped without
// DATABASE_URL. Never run against a shared or production database. Every fixture row (archived
// rows included) is removed by tenant id in afterAll.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TZ = "Europe/Istanbul";
const WIDE = { startAt: new Date("2000-01-01T00:00:00.000Z"), endAt: new Date("2100-01-01T00:00:00.000Z") };

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

describeDatabase("soft delete integration (archive / erase)", () => {
  const suffix = randomUUID();
  const created: string[] = [];
  let seq = 0;
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
  const uid = (label: string) => `sd-${label}-${suffix}-${++seq}`;
  const ctx = (tenantId: string) => ({ tenantId: tenantId as never });

  const seedTenant = async (label: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
    const id = uid(`tenant-${label}`);
    created.push(id); // registered before insert so a partial failure is still cleaned
    await db().query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "status", ${TENANT_LEGAL_COLUMNS_SQL}, "createdAt", "updatedAt")
       VALUES ($1, $1, $2, '${TZ}', $3::"TenantStatus", $4, $5, $6, now(), now())`,
      [id, `Soft Delete ${label}`, status, ...TENANT_LEGAL_VALUES],
    );
    return { tenantId: id, slug: id, name: `Soft Delete ${label}` };
  };
  const seedProfile = async (tenantId: string, label: string, contact?: { email: string; phone: string }) => {
    const id = uid(`profile-${label}`);
    await db().query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "email", "phone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [id, tenantId, `Person ${label}`, contact?.email ?? null, contact?.phone ?? null],
    );
    return id;
  };
  const seedMembership = async (tenantId: string, profileId: string, role: string) => {
    const subjectId = `sub-${profileId}`;
    await db().query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "subjectId", "profileId", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::"TenantRole", now(), now())`,
      [uid("membership"), tenantId, subjectId, profileId, role],
    );
    return subjectId;
  };
  const seedStaff = async (tenantId: string, label: string, withMembership = true) => {
    const profileId = await seedProfile(tenantId, `staff-${label}`, { email: `${uid("e")}@example.test`, phone: "+905550000001" });
    const id = uid(`staff-${label}`);
    await db().query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [id, tenantId, profileId],
    );
    const subjectId = withMembership ? await seedMembership(tenantId, profileId, "STAFF") : null;
    return { id, profileId, subjectId };
  };
  const seedService = async (tenantId: string, label: string) => {
    const id = uid(`service-${label}`);
    await db().query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [id, tenantId, `Service ${label}`],
    );
    return id;
  };
  /** Distinct day offsets keep appointments of one staff from overlapping. */
  const seedAppointment = async (
    tenantId: string,
    row: { staffId: string; serviceId: string; customerProfileId: string; status: string; when: "future" | "past" },
  ) => {
    const id = uid("appointment");
    const days = (row.when === "future" ? 1 : -1) * (++seq % 300 + 1);
    await db().query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6::"AppointmentStatus", now() + ($7 || ' days')::interval, now() + ($7 || ' days')::interval + interval '30 minutes', now(), now())`,
      [id, tenantId, row.staffId, row.serviceId, row.customerProfileId, row.status, String(days)],
    );
    return id;
  };
  const seedContact = async (tenantId: string, appointmentId: string, tenantName: string, optIn: boolean) => {
    await db().query(...publicContactInsert({
      tenantId, appointmentId, tenantName, displayName: "Contact Snapshot", phone: "+905557000009", optIn,
    }));
  };

  const cleanupTenant = async (tenantId: string) => {
    const p = db();
    for (const table of [
      "CustomerNote", "PushSubscription", "NotificationDelivery", "AppointmentAccessToken", "AppointmentContact",
      "AppointmentService", "Appointment", "StaffService", "TenantMembership", "WorkingHours", "Staff", "Service", "Profile",
    ]) {
      await p.query(`DELETE FROM "${table}" WHERE "tenantId" = $1`, [tenantId]);
    }
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [tenantId]);
  };

  const one = async (sql: string, params: unknown[]) => {
    const result = await db().query(sql, params);
    return result.rows[0] as Record<string, unknown> | undefined;
  };
  const count = async (table: string, tenantId: string, where = "TRUE", params: unknown[] = []) => {
    const row = await one(`SELECT count(*)::int AS n FROM "${table}" WHERE "tenantId" = $1 AND ${where}`, [tenantId, ...params]);
    return row?.n as number;
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, max: 20 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    for (const tenantId of created) {
      try {
        await cleanupTenant(tenantId);
      } catch (error) {
        errors.push(`cleanup failed for ${tenantId}: ${String(error)}`);
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

  // Tenant A owns everything; tenant B only supplies the (foreign) context.
  it("tenant B context cannot archive tenant A's staff, service, customer, note or appointment", async () => {
    const a = await seedTenant("iso-a");
    const b = await seedTenant("iso-b");
    const bActor = await seedProfile(b.tenantId, "actor");
    const staff = await seedStaff(a.tenantId, "iso");
    const service = await seedService(a.tenantId, "iso");
    const customer = await seedProfile(a.tenantId, "iso-customer", { email: "keep@example.test", phone: "+905550000002" });
    const noteId = uid("note");
    await db().query(
      `INSERT INTO "CustomerNote" ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'keep me', now(), now())`,
      [noteId, a.tenantId, customer],
    );
    const appointment = await seedAppointment(a.tenantId, {
      staffId: staff.id, serviceId: service, customerProfileId: customer, status: "CANCELLED", when: "past",
    });
    const now = new Date();
    const ctxB = ctx(b.tenantId);

    await expect(createPrismaStaffDeletionRepository(client()).archive(ctxB, { staffId: staff.id, actorProfileId: bActor, now }))
      .resolves.toBe("not_found");
    await expect(createPrismaServiceDeletionRepository(client()).archive(ctxB, { serviceId: service, now })).resolves.toBe("not_found");
    const customers = createPrismaCustomerDeletionRepository(client());
    await expect(customers.erase(ctxB, { profileId: customer, now })).resolves.toBe("not_found");
    await expect(customers.deleteNote(ctxB, noteId)).resolves.toBe("not_found");
    await expect(createPrismaAppointmentDeletionRepository(client()).archive(ctxB, appointment, now)).resolves.toBe("not_found");

    expect(await count("Staff", a.tenantId, '"id" = $2 AND "deletedAt" IS NULL AND "status" = \'ACTIVE\'', [staff.id])).toBe(1);
    expect(await count("TenantMembership", a.tenantId, '"profileId" = $2', [staff.profileId])).toBe(1);
    expect(await count("Service", a.tenantId, '"id" = $2 AND "deletedAt" IS NULL AND "active"', [service])).toBe(1);
    expect(await one('SELECT "displayName", "email", "phone", "deletedAt" FROM "Profile" WHERE "tenantId" = $1 AND "id" = $2', [a.tenantId, customer]))
      .toEqual({ displayName: "Person iso-customer", email: "keep@example.test", phone: "+905550000002", deletedAt: null });
    expect(await count("CustomerNote", a.tenantId, '"id" = $2', [noteId])).toBe(1);
    expect(await count("Appointment", a.tenantId, '"id" = $2 AND "deletedAt" IS NULL', [appointment])).toBe(1);
  });

  it("staff archive removes the membership and the membership reader then returns not_found", async () => {
    const t = await seedTenant("staff-archive");
    const admin = await seedProfile(t.tenantId, "admin");
    const staff = await seedStaff(t.tenantId, "gone");
    const service = await seedService(t.tenantId, "perform");
    await db().query(
      `INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId", "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [uid("staffservice"), t.tenantId, staff.id, service],
    );
    const reader = createPrismaMembershipReader({ prisma: client() });
    const identity = createAuthenticatedIdentity(staff.subjectId as string, staff.profileId);
    await expect(reader.readMembership({ tenantContext: ctx(t.tenantId), identity })).resolves.toMatchObject({ status: "found" });

    const now = new Date();
    await expect(createPrismaStaffDeletionRepository(client()).archive(ctx(t.tenantId), { staffId: staff.id, actorProfileId: admin, now }))
      .resolves.toBe("archived");

    await expect(reader.readMembership({ tenantContext: ctx(t.tenantId), identity })).resolves.toEqual({ status: "not_found" });
    expect(await count("TenantMembership", t.tenantId, '"profileId" = $2', [staff.profileId])).toBe(0);
    expect(await count("StaffService", t.tenantId, '"staffId" = $2', [staff.id])).toBe(0);
    expect(await one('SELECT "status"::text AS status, "deletedAt" IS NOT NULL AS archived FROM "Staff" WHERE "tenantId" = $1 AND "id" = $2', [t.tenantId, staff.id]))
      .toEqual({ status: "INACTIVE", archived: true });
    expect(await one('SELECT "email" FROM "Profile" WHERE "tenantId" = $1 AND "id" = $2', [t.tenantId, staff.profileId])).toEqual({ email: null });
    // A second archive of the same row is not_found, not an error.
    await expect(createPrismaStaffDeletionRepository(client()).archive(ctx(t.tenantId), { staffId: staff.id, actorProfileId: admin, now }))
      .resolves.toBe("not_found");
  });

  it("membership reader still reads a live tenant's membership under the runtime path", async () => {
    const t = await seedTenant("live-membership");
    const profileId = await seedProfile(t.tenantId, "admin");
    const subjectId = await seedMembership(t.tenantId, profileId, "TENANT_ADMIN");
    const result = await createPrismaMembershipReader({ prisma: client() }).readMembership({
      tenantContext: ctx(t.tenantId),
      identity: createAuthenticatedIdentity(subjectId, profileId),
    });
    expect(result).toEqual({
      status: "found",
      membership: { tenantId: t.tenantId, subjectId, profileId, role: "TENANT_ADMIN" },
    });
  });

  it("staff and service archive with a future CONFIRMED appointment is blocked and writes nothing", async () => {
    const t = await seedTenant("blocked");
    const admin = await seedProfile(t.tenantId, "admin");
    const customer = await seedProfile(t.tenantId, "customer");
    const staff = await seedStaff(t.tenantId, "busy");
    const otherStaff = await seedStaff(t.tenantId, "other");
    const service = await seedService(t.tenantId, "busy");
    const multiService = await seedService(t.tenantId, "multi");
    const plainService = await seedService(t.tenantId, "plain");
    await db().query(
      `INSERT INTO "StaffService" ("id", "tenantId", "staffId", "serviceId", "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [uid("staffservice"), t.tenantId, staff.id, service],
    );
    await seedAppointment(t.tenantId, { staffId: staff.id, serviceId: service, customerProfileId: customer, status: "CONFIRMED", when: "future" });
    // Multi-service path: the appointment's primary service differs but it also lists `multiService`.
    const multiAppointment = await seedAppointment(t.tenantId, {
      staffId: otherStaff.id, serviceId: plainService, customerProfileId: customer, status: "PENDING", when: "future",
    });
    await db().query(
      `INSERT INTO "AppointmentService" ("id", "tenantId", "appointmentId", "serviceId", "position", "createdAt") VALUES ($1, $2, $3, $4, 1, now())`,
      [uid("apptservice"), t.tenantId, multiAppointment, multiService],
    );
    const now = new Date();

    await expect(createPrismaStaffDeletionRepository(client()).archive(ctx(t.tenantId), { staffId: staff.id, actorProfileId: admin, now }))
      .resolves.toEqual({ status: "has_active_appointments", count: 1 });
    await expect(createPrismaServiceDeletionRepository(client()).archive(ctx(t.tenantId), { serviceId: service, now }))
      .resolves.toEqual({ status: "has_active_appointments", count: 1 });
    await expect(createPrismaServiceDeletionRepository(client()).archive(ctx(t.tenantId), { serviceId: multiService, now }))
      .resolves.toEqual({ status: "has_active_appointments", count: 1 });

    expect(await count("Staff", t.tenantId, '"id" = $2 AND "deletedAt" IS NULL AND "status" = \'ACTIVE\'', [staff.id])).toBe(1);
    expect(await count("TenantMembership", t.tenantId, '"profileId" = $2', [staff.profileId])).toBe(1);
    expect(await count("StaffService", t.tenantId, '"staffId" = $2', [staff.id])).toBe(1);
    expect(await count("Service", t.tenantId, '"id" = ANY($2) AND "deletedAt" IS NULL AND "active"', [[service, multiService]])).toBe(2);
    expect(await count("Appointment", t.tenantId, '"deletedAt" IS NULL')).toBe(2);
  });

  it("customer erase clears profile and contact PII, deletes notes and keeps consent fields", async () => {
    const t = await seedTenant("erase");
    const staff = await seedStaff(t.tenantId, "host");
    const service = await seedService(t.tenantId, "erase");
    const customer = await seedProfile(t.tenantId, "erase", { email: "erase@example.test", phone: "+905550000003" });
    for (const body of ["note one", "note two"]) {
      await db().query(
        `INSERT INTO "CustomerNote" ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())`,
        [uid("note"), t.tenantId, customer, body],
      );
    }
    const past = await seedAppointment(t.tenantId, { staffId: staff.id, serviceId: service, customerProfileId: customer, status: "COMPLETED", when: "past" });
    await seedContact(t.tenantId, past, t.name, true);
    const consentSql = 'SELECT "whatsappOptIn", "optInVersion", "optInHash", "optInAt" IS NOT NULL AS "hasOptInAt", "noticeVersion", "noticeHash", "noticeShownAt" IS NOT NULL AS "hasNoticeAt" FROM "AppointmentContact" WHERE "tenantId" = $1 AND "appointmentId" = $2';
    const consentBefore = await one(consentSql, [t.tenantId, past]);
    expect(consentBefore?.whatsappOptIn).toBe(true);

    await expect(createPrismaCustomerDeletionRepository(client()).erase(ctx(t.tenantId), { profileId: customer, now: new Date() }))
      .resolves.toBe("erased");

    expect(await one('SELECT "displayName", "email", "phone", "deletedAt" IS NOT NULL AS archived FROM "Profile" WHERE "tenantId" = $1 AND "id" = $2', [t.tenantId, customer]))
      .toEqual({ displayName: DELETED_CUSTOMER_NAME, email: null, phone: null, archived: true });
    expect(await count("CustomerNote", t.tenantId, '"customerProfileId" = $2', [customer])).toBe(0);
    expect(await one('SELECT "displayName", "email", "phone" FROM "AppointmentContact" WHERE "tenantId" = $1 AND "appointmentId" = $2', [t.tenantId, past]))
      .toEqual({ displayName: DELETED_CUSTOMER_NAME, email: null, phone: null });
    // Consent evidence is untouched.
    expect(await one(consentSql, [t.tenantId, past])).toEqual(consentBefore);
    // The appointment row itself survives for history.
    expect(await count("Appointment", t.tenantId, '"id" = $2', [past])).toBe(1);
  });

  it("customer erase of a contact without WhatsApp opt-in also succeeds and clears contact PII", async () => {
    const t = await seedTenant("erase-no-optin");
    const staff = await seedStaff(t.tenantId, "host");
    const service = await seedService(t.tenantId, "erase");
    const customer = await seedProfile(t.tenantId, "erase", { email: "erase2@example.test", phone: "+905550000004" });
    const past = await seedAppointment(t.tenantId, { staffId: staff.id, serviceId: service, customerProfileId: customer, status: "CANCELLED", when: "past" });
    await seedContact(t.tenantId, past, t.name, false);
    await expect(createPrismaCustomerDeletionRepository(client()).erase(ctx(t.tenantId), { profileId: customer, now: new Date() }))
      .resolves.toBe("erased");
    expect(await one('SELECT "displayName", "phone", "whatsappOptIn" FROM "AppointmentContact" WHERE "tenantId" = $1 AND "appointmentId" = $2', [t.tenantId, past]))
      .toEqual({ displayName: DELETED_CUSTOMER_NAME, phone: null, whatsappOptIn: false });
  });

  it("customer erase is refused for a future active appointment and for team members, writing nothing", async () => {
    const t = await seedTenant("erase-blocked");
    const staff = await seedStaff(t.tenantId, "host");
    const service = await seedService(t.tenantId, "erase");
    const customer = await seedProfile(t.tenantId, "busy", { email: "busy@example.test", phone: "+905550000005" });
    await seedAppointment(t.tenantId, { staffId: staff.id, serviceId: service, customerProfileId: customer, status: "PENDING", when: "future" });
    const repository = createPrismaCustomerDeletionRepository(client());
    const now = new Date();

    await expect(repository.erase(ctx(t.tenantId), { profileId: customer, now })).resolves.toEqual({ status: "has_active_appointments", count: 1 });
    await expect(repository.erase(ctx(t.tenantId), { profileId: staff.profileId, now })).resolves.toBe("not_customer");
    expect(await one('SELECT "displayName", "email", "deletedAt" FROM "Profile" WHERE "tenantId" = $1 AND "id" = $2', [t.tenantId, customer]))
      .toEqual({ displayName: "Person busy", email: "busy@example.test", deletedAt: null });
    expect(await count("Profile", t.tenantId, '"id" = $2 AND "deletedAt" IS NULL', [staff.profileId])).toBe(1);
  });

  it("appointment archive only accepts terminal statuses and a note delete only removes its own note", async () => {
    const t = await seedTenant("appt-archive");
    const staff = await seedStaff(t.tenantId, "host");
    const service = await seedService(t.tenantId, "host");
    const customer = await seedProfile(t.tenantId, "customer");
    const base = { staffId: staff.id, serviceId: service, customerProfileId: customer };
    const terminal = await seedAppointment(t.tenantId, { ...base, status: "CANCELLED", when: "past" });
    const active = await seedAppointment(t.tenantId, { ...base, status: "CONFIRMED", when: "future" });
    const repository = createPrismaAppointmentDeletionRepository(client());
    const now = new Date();

    await expect(repository.archive(ctx(t.tenantId), active, now)).resolves.toBe("not_terminal");
    await expect(repository.archive(ctx(t.tenantId), terminal, now)).resolves.toBe("archived");
    await expect(repository.archive(ctx(t.tenantId), terminal, now)).resolves.toBe("not_found");
    await expect(repository.find(ctx(t.tenantId), terminal)).resolves.toBeNull();
    expect(await count("Appointment", t.tenantId, '"id" = $2 AND "deletedAt" IS NOT NULL', [terminal])).toBe(1);
    expect(await count("Appointment", t.tenantId, '"id" = $2 AND "deletedAt" IS NULL', [active])).toBe(1);

    const noteId = uid("note");
    await db().query(
      `INSERT INTO "CustomerNote" ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'x', now(), now())`,
      [noteId, t.tenantId, customer],
    );
    await expect(createPrismaCustomerDeletionRepository(client()).deleteNote(ctx(t.tenantId), noteId)).resolves.toBe("deleted");
    await expect(createPrismaCustomerDeletionRepository(client()).deleteNote(ctx(t.tenantId), noteId)).resolves.toBe("not_found");
  });

  it("archived appointment, staff, service and customer are absent from each list repository", async () => {
    const t = await seedTenant("lists");
    const admin = await seedProfile(t.tenantId, "admin");
    const keepStaff = await seedStaff(t.tenantId, "keep");
    const goneStaff = await seedStaff(t.tenantId, "gone");
    const keepService = await seedService(t.tenantId, "keep");
    const goneService = await seedService(t.tenantId, "gone");
    const keepCustomer = await seedProfile(t.tenantId, "keep");
    const goneCustomer = await seedProfile(t.tenantId, "gone");
    const base = { staffId: keepStaff.id, serviceId: keepService };
    const keepAppt = await seedAppointment(t.tenantId, { ...base, customerProfileId: keepCustomer, status: "COMPLETED", when: "past" });
    const goneAppt = await seedAppointment(t.tenantId, { ...base, customerProfileId: keepCustomer, status: "CANCELLED", when: "past" });
    const goneCustomerAppt = await seedAppointment(t.tenantId, { ...base, customerProfileId: goneCustomer, status: "COMPLETED", when: "past" });
    const tenantContext = ctx(t.tenantId);
    const now = new Date();

    const crm = createPrismaCalendarCrmRepository(client());
    const staffRepo = createPrismaStaffRepository(client());
    const serviceRepo = createPrismaServiceRepository(client());
    const staffAppointments = createPrismaStaffAppointmentsRepository(client());
    const publicSalon = createPrismaPublicSalonRepository(client());
    const customerIds = async () => (await crm.listCustomers(tenantContext, "")).map((c) => c.id);
    const calendarIds = async () => (await crm.listAppointments(tenantContext, WIDE)).map((a) => a.id);
    const staffIds = async () => (await staffRepo.list(tenantContext)).map((s) => s.id);
    const serviceIds = async () => (await serviceRepo.list(tenantContext)).map((s) => s.id);
    const ownIds = async () => (await staffAppointments.listForStaff(tenantContext, keepStaff.id, WIDE)).map((a) => a.id);

    // Baseline: everything is listed before archiving (guards against vacuous assertions).
    expect(await customerIds()).toEqual(expect.arrayContaining([keepCustomer, goneCustomer]));
    expect(await calendarIds()).toEqual(expect.arrayContaining([keepAppt, goneAppt, goneCustomerAppt]));
    expect(await staffIds()).toEqual(expect.arrayContaining([keepStaff.id, goneStaff.id]));
    expect(await serviceIds()).toEqual(expect.arrayContaining([keepService, goneService]));
    expect(await ownIds()).toEqual(expect.arrayContaining([keepAppt, goneAppt]));

    await expect(createPrismaAppointmentDeletionRepository(client()).archive(tenantContext, goneAppt, now)).resolves.toBe("archived");
    await expect(createPrismaStaffDeletionRepository(client()).archive(tenantContext, { staffId: goneStaff.id, actorProfileId: admin, now })).resolves.toBe("archived");
    await expect(createPrismaServiceDeletionRepository(client()).archive(tenantContext, { serviceId: goneService, now })).resolves.toBe("archived");
    await expect(createPrismaCustomerDeletionRepository(client()).erase(tenantContext, { profileId: goneCustomer, now })).resolves.toBe("erased");

    const customers = await customerIds();
    expect(customers).toContain(keepCustomer);
    expect(customers).not.toContain(goneCustomer);
    const calendar = await calendarIds();
    expect(calendar).toContain(keepAppt);
    expect(calendar).not.toContain(goneAppt);
    const staff = await staffIds();
    expect(staff).toContain(keepStaff.id);
    expect(staff).not.toContain(goneStaff.id);
    const services = await serviceIds();
    expect(services).toContain(keepService);
    expect(services).not.toContain(goneService);
    const own = await ownIds();
    expect(own).toContain(keepAppt);
    expect(own).not.toContain(goneAppt);
    await expect(staffAppointments.findById(tenantContext, goneAppt)).resolves.toBeNull();
    await expect(staffAppointments.findById(tenantContext, keepAppt)).resolves.not.toBeNull();

    // Public catalog (vitrin) also hides archived staff and services.
    const catalog = await publicSalon.catalog(tenantContext);
    expect(catalog.staff.map((s) => s.id)).toEqual(expect.arrayContaining([keepStaff.id]));
    expect(catalog.staff.map((s) => s.id)).not.toContain(goneStaff.id);
    expect(catalog.services.map((s) => s.id)).toContain(keepService);
    expect(catalog.services.map((s) => s.id)).not.toContain(goneService);
  });

  it("archived tenant: membership reader returns not_found and the vitrin slug lookup is missing", async () => {
    const t = await seedTenant("tenant-archive", "INACTIVE");
    const profileId = await seedProfile(t.tenantId, "admin");
    const subjectId = await seedMembership(t.tenantId, profileId, "TENANT_ADMIN");
    const other = await seedTenant("tenant-archive-other");
    const platform = createPrismaPlatformTenantRepository(prisma as unknown as PrismaPlatformTenantClient);
    const reader = createPrismaMembershipReader({ prisma: client() });
    const vitrin = createPrismaPublicSalonRepository(client());
    const identity = createAuthenticatedIdentity(subjectId, profileId);
    const lookup = () => reader.readMembership({ tenantContext: ctx(t.tenantId), identity });

    await expect(lookup()).resolves.toMatchObject({ status: "found" });
    await expect(vitrin.resolveBySlug(t.slug)).resolves.not.toBeNull();

    // Refusals write nothing: wrong slug, then an ACTIVE tenant.
    const archivedAt = (id: string) => one('SELECT "deletedAt" FROM "Tenant" WHERE "id" = $1', [id]);
    await expect(platform.archive(t.tenantId, "wrong-slug", new Date())).resolves.toBe("slug_mismatch");
    await expect(platform.archive(other.tenantId, other.slug, new Date())).resolves.toBe("active");
    expect(await archivedAt(t.tenantId)).toEqual({ deletedAt: null });
    expect(await archivedAt(other.tenantId)).toEqual({ deletedAt: null });

    await expect(platform.archive(t.tenantId, t.slug, new Date())).resolves.toBe("archived");
    expect((await archivedAt(t.tenantId))?.deletedAt).toBeInstanceOf(Date);

    await expect(lookup()).resolves.toEqual({ status: "not_found" });
    await expect(vitrin.resolveBySlug(t.slug)).resolves.toBeNull();
    expect((await platform.list()).map((tenant) => tenant.id)).not.toContain(t.tenantId);
    expect((await platform.list()).map((tenant) => tenant.id)).toContain(other.tenantId);
    // An archived tenant can neither be archived again nor reactivated.
    await expect(platform.archive(t.tenantId, t.slug, new Date())).resolves.toBe("not_found");
    await expect(platform.setStatus(t.tenantId, "ACTIVE")).resolves.toBe("not_found");
    expect(await one('SELECT "status"::text AS status FROM "Tenant" WHERE "id" = $1', [t.tenantId])).toEqual({ status: "INACTIVE" });
    // The membership row itself is untouched (read filter only).
    expect(await count("TenantMembership", t.tenantId)).toBe(1);
  });

  // Booking takes Tenant FOR SHARE, archive takes Tenant FOR UPDATE: whichever commits first, an
  // archived staff member must never be left with a future PENDING/CONFIRMED appointment.
  it("parallel public booking and staff archive never leave an active appointment on an archived staff member", async () => {
    const t = await seedTenant("race");
    const admin = await seedProfile(t.tenantId, "admin");
    const service = await seedService(t.tenantId, "race");
    await db().query(
      `INSERT INTO "WorkingHours" ("id", "tenantId", "dayOfWeek", "openMinute", "closeMinute", "createdAt", "updatedAt") VALUES ($1, $2, 1, 540, 1080, now(), now())`,
      [uid("hours"), t.tenantId],
    );
    const booking = createPublicBooking(createPrismaPublicBookingRepository(client()));
    const staffRepository = createPrismaStaffDeletionRepository(client());
    const monday = nextMondayIso();
    const ROUNDS = 5;
    const outcomes: string[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      const staff = await seedStaff(t.tenantId, `race-${round}`);
      const startAt = localWallTimeToUtc(addDaysToDateIso(monday, 7 * (round + 1)), 10 * 60, TZ);
      const [bookingResult, archiveResult] = await Promise.all([
        booking.create(ctx(t.tenantId), {
          serviceId: service, staffId: staff.id, startAt, displayName: "Race Guest",
          email: `race-${randomUUID()}@example.com`, phone: null, ...publicLegalInput(t.name),
        }),
        staffRepository.archive(ctx(t.tenantId), { staffId: staff.id, actorProfileId: admin, now: new Date() }),
      ]);

      const active = await count(
        "Appointment", t.tenantId,
        `"staffId" = $2 AND "deletedAt" IS NULL AND "status" IN ('PENDING', 'CONFIRMED') AND "startAt" > now()`, [staff.id],
      );
      const archived = await count("Staff", t.tenantId, '"id" = $2 AND "deletedAt" IS NOT NULL', [staff.id]);
      // Never both: an archived staff member with an active future appointment.
      expect(archived === 1 && active > 0).toBe(false);
      if (archiveResult === "archived") {
        expect(active).toBe(0);
        expect(archived).toBe(1);
        expect(bookingResult.status).not.toBe("created");
      } else {
        // Booking committed first: the archive saw it and was blocked.
        expect(archiveResult).toEqual({ status: "has_active_appointments", count: 1 });
        expect(archived).toBe(0);
        expect(active).toBe(1);
      }
      outcomes.push(archiveResult === "archived" ? "archive-first" : "booking-first");
    }
    expect(outcomes).toHaveLength(ROUNDS);
  });
});
