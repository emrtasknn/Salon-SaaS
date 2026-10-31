import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaCalendarCrmRepository } from "./prisma-calendar-crm";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Fixture = {
  tenantId: string;
  slug: string;
  customerId: string;
  staffProfileId: string;
  staffId: string;
  serviceId: string;
  appointmentId: string;
  noteId: string;
};

const fixture = (label: string): Fixture => {
  const suffix = randomUUID();
  return {
    tenantId: `crm-integration-${label}-${suffix}`,
    slug: `crm-integration-${label}-${suffix}`,
    customerId: `crm-customer-${label}-${suffix}`,
    staffProfileId: `crm-staff-profile-${label}-${suffix}`,
    staffId: `crm-staff-${label}-${suffix}`,
    serviceId: `crm-service-${label}-${suffix}`,
    appointmentId: `crm-appointment-${label}-${suffix}`,
    noteId: `crm-note-${label}-${suffix}`,
  };
};

describeDatabase("Prisma CRM customer history integration", () => {
  const tenantA = fixture("a");
  const tenantB = fixture("b");
  const startAt = new Date("2026-10-20T10:00:00.000Z");
  const endAt = new Date("2026-10-20T10:30:00.000Z");

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const seedTenant = async (data: Fixture, label: string) => {
    if (!pool) throw new Error("Database pool was not initialized");

    await pool.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [data.tenantId, data.slug, `CRM Integration ${label}`],
    );
    await pool.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now())`,
      [
        data.customerId,
        data.tenantId,
        `Customer ${label}`,
        data.staffProfileId,
        `Staff ${label}`,
      ],
    );
    await pool.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [data.staffId, data.tenantId, data.staffProfileId],
    );
    await pool.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [data.serviceId, data.tenantId, `Service ${label}`],
    );
    await pool.query(
      `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6, $7, now(), now())`,
      [
        data.appointmentId,
        data.tenantId,
        data.staffId,
        data.serviceId,
        data.customerId,
        startAt,
        endAt,
      ],
    );
    await pool.query(
      `INSERT INTO "CustomerNote" ("id", "tenantId", "customerProfileId", "body", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now())`,
      [data.noteId, data.tenantId, data.customerId, `Private note ${label}`],
    );
  };

  const cleanupTenant = async (data: Fixture) => {
    if (!pool) return;
    await pool.query('DELETE FROM "CustomerNote" WHERE "id" = $1', [data.noteId]);
    await pool.query('DELETE FROM "Appointment" WHERE "id" = $1', [data.appointmentId]);
    await pool.query('DELETE FROM "Staff" WHERE "id" = $1', [data.staffId]);
    await pool.query('DELETE FROM "Service" WHERE "id" = $1', [data.serviceId]);
    await pool.query(
      'DELETE FROM "Profile" WHERE "id" IN ($1, $2)',
      [data.customerId, data.staffProfileId],
    );
    await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [data.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");
  });

  afterAll(async () => {
    if (!pool || !prisma) return;
    const cleanupErrors: string[] = [];
    for (const data of [tenantA, tenantB]) {
      try {
        await cleanupTenant(data);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${data.tenantId}: ${String(error)}`);
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

  it("loads persisted service, staff, appointment, and note data for the current tenant", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaCalendarCrmRepository(
      prisma as unknown as PrismaTenantClient,
    );

    const result = await repository.customerCard(
      { tenantId: tenantA.tenantId as never },
      tenantA.customerId,
    );

    expect(result).toMatchObject({
      id: tenantA.customerId,
      displayName: "Customer A",
      appointments: [
        {
          id: tenantA.appointmentId,
          tenantId: tenantA.tenantId,
          staffDisplayName: "Staff A",
          serviceName: "Service A",
          status: "CONFIRMED",
          startAt,
          endAt,
        },
      ],
      notes: [{ id: tenantA.noteId, body: "Private note A" }],
    });
    expect(result?.appointments).toHaveLength(1);
    expect(result?.notes).toHaveLength(1);
    expect(result?.appointments.some((item) => item.id === tenantB.appointmentId)).toBe(false);
    expect(result?.notes.some((item) => item.id === tenantB.noteId)).toBe(false);
  });

  it("does not resolve a customer belonging to another tenant", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaCalendarCrmRepository(
      prisma as unknown as PrismaTenantClient,
    );

    const result = await repository.customerCard(
      { tenantId: tenantA.tenantId as never },
      tenantB.customerId,
    );

    expect(result).toBeNull();
  });

  it("keeps customer search and calendar results isolated in both tenant directions", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaCalendarCrmRepository(
      prisma as unknown as PrismaTenantClient,
    );
    const contextA = { tenantId: tenantA.tenantId as never };
    const contextB = { tenantId: tenantB.tenantId as never };
    const range = {
      startAt: new Date(startAt.getTime() - 60 * 60_000),
      endAt: new Date(endAt.getTime() + 60 * 60_000),
    };

    const [customersA, customersB, appointmentsA, appointmentsB] = await Promise.all([
      repository.listCustomers(contextA, "Customer"),
      repository.listCustomers(contextB, "Customer"),
      repository.listAppointments(contextA, range),
      repository.listAppointments(contextB, range),
    ]);

    expect(customersA.map((customer) => customer.id)).toEqual([tenantA.customerId]);
    expect(customersB.map((customer) => customer.id)).toEqual([tenantB.customerId]);
    expect(appointmentsA.map((appointment) => appointment.id)).toEqual([tenantA.appointmentId]);
    expect(appointmentsB.map((appointment) => appointment.id)).toEqual([tenantB.appointmentId]);
    expect(appointmentsA.every((appointment) => appointment.tenantId === tenantA.tenantId)).toBe(true);
    expect(appointmentsB.every((appointment) => appointment.tenantId === tenantB.tenantId)).toBe(true);
  });

  it("rejects cross-tenant customer-note mutation and preserves each tenant's notes", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    const repository = createPrismaCalendarCrmRepository(
      prisma as unknown as PrismaTenantClient,
    );
    const contextA = { tenantId: tenantA.tenantId as never };
    const contextB = { tenantId: tenantB.tenantId as never };

    await expect(
      repository.addCustomerNote(contextA, tenantB.customerId, "Cross-tenant write attempt"),
    ).resolves.toBe("not_found");

    await expect(
      repository.addCustomerNote(contextA, tenantA.customerId, "Tenant A follow-up"),
    ).resolves.toBe("created");

    const [cardA, cardB] = await Promise.all([
      repository.customerCard(contextA, tenantA.customerId),
      repository.customerCard(contextB, tenantB.customerId),
    ]);

    expect(cardA?.notes.map((note) => note.body)).toEqual([
      "Tenant A follow-up",
      "Private note A",
    ]);
    expect(cardB?.notes.map((note) => note.body)).toEqual(["Private note B"]);
    expect(cardB?.notes.some((note) => note.body === "Cross-tenant write attempt")).toBe(false);
  });

});
