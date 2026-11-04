import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { localWallTimeToUtc } from "../domain/availability";

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function makeTransaction(overrides: Readonly<{
  service?: unknown;
  staff?: unknown;
  profile?: unknown;
  tenantStatus?: string | null;
  closures?: string[];
}> = {}) {
  const tenantStatus = overrides.tenantStatus !== undefined ? overrides.tenantStatus : "ACTIVE";
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue(tenantStatus === null ? [] : [{ status: tenantStatus }]),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: "tenant-a", timezone: "Europe/Istanbul" }) },
    workingHours: { findMany: vi.fn().mockResolvedValue([{ id: "wh", tenantId: "tenant-a", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]) },
    service: { findUnique: vi.fn().mockResolvedValue(overrides.service !== undefined ? overrides.service : { id: "svc-a", durationMinutes: 60, bufferMinutes: 15, active: true }) },
    staff: { findUnique: vi.fn().mockResolvedValue(overrides.staff !== undefined ? overrides.staff : { id: "staff-a", status: "ACTIVE" }) },
    profile: { findUnique: vi.fn().mockResolvedValue(overrides.profile !== undefined ? overrides.profile : { id: "c" }), create: vi.fn() },
    appointment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "a" }) },
    appointmentAccessToken: { create: vi.fn().mockResolvedValue({ id: "t" }) },
    closureDate: { findMany: vi.fn().mockResolvedValue((overrides.closures ?? []).map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) }))) },
  };
}

function makePrisma(transaction: ReturnType<typeof makeTransaction>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(transaction as never));
  return prisma;
}

const validInput = {
  serviceId: "svc-a",
  staffId: "staff-a",
  startAt: localWallTimeToUtc(nextMondayIso(), 9 * 60, "Europe/Istanbul"),
  displayName: "Customer",
  email: "c@example.com",
  phone: null,
  accessTokenHash: "a".repeat(64),
};

describe("public booking repository", () => {
  it("uses tenant context, advisory lock and creates a pending appointment", async () => {
    const transaction = makeTransaction();
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toEqual({ status: "created", appointmentId: "a" });
    expect(transaction.$executeRaw).toHaveBeenCalled();
  });

  it("stores only the access-token hash, expiring 7 days after endAt, in the booking transaction", async () => {
    const transaction = makeTransaction();
    await createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput);
    const endAt = new Date(validInput.startAt.getTime() + 75 * 60_000);
    expect(transaction.appointmentAccessToken.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-a", appointmentId: "a", tokenHash: "a".repeat(64), expiresAt: new Date(endAt.getTime() + 7 * 24 * 60 * 60_000) },
      select: { id: true },
    });
  });

  it("fails the booking when the token insert fails", async () => {
    const transaction = makeTransaction();
    transaction.appointmentAccessToken.create.mockRejectedValueOnce(new Error("check violation"));
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("persistence_failure");
  });

  it("inserts exactly one token, after the appointment, inside the same tenant-context transaction", async () => {
    const transaction = makeTransaction();
    const prisma = makePrisma(transaction);
    await createPrismaPublicBookingRepository(prisma).create({ tenantId: "tenant-a" as never }, validInput);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.appointmentAccessToken.create).toHaveBeenCalledOnce();
    expect(transaction.appointment.create.mock.invocationCallOrder[0])
      .toBeLessThan(transaction.appointmentAccessToken.create.mock.invocationCallOrder[0]);
    const tenantGuc = transaction.$executeRaw.mock.calls.find((call) => String(call[0]).includes("app.tenant_id"));
    expect(tenantGuc?.[1]).toBe("tenant-a");
  });

  it("does not insert a token when the slot is unavailable or the resource is foreign", async () => {
    const conflict = makeTransaction();
    conflict.appointment.findMany.mockResolvedValueOnce([{
      id: "x", tenantId: "tenant-a", staffId: "staff-a", serviceId: "svc-a", customerProfileId: "c",
      startAt: validInput.startAt, endAt: new Date(validInput.startAt.getTime() + 75 * 60_000), status: "PENDING" as const,
    }]);
    await expect(createPrismaPublicBookingRepository(makePrisma(conflict)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("slot_unavailable");
    expect(conflict.appointmentAccessToken.create).not.toHaveBeenCalled();

    const foreign = makeTransaction({ service: null });
    await expect(createPrismaPublicBookingRepository(makePrisma(foreign)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("invalid_resource");
    expect(foreign.appointmentAccessToken.create).not.toHaveBeenCalled();
  });

  it("uses one lock for overlapping appointments with different start times", async () => {
    const transaction = makeTransaction();
    const existingAppointment = {
      id: "a", tenantId: "tenant-a", staffId: "staff-a", serviceId: "svc-a", customerProfileId: "c",
      startAt: validInput.startAt, endAt: new Date(validInput.startAt.getTime() + 75 * 60_000), status: "PENDING" as const,
    };
    transaction.appointment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([existingAppointment]);

    const repository = createPrismaPublicBookingRepository(makePrisma(transaction));
    await expect(repository.create({ tenantId: "tenant-a" as never }, validInput)).resolves.toEqual({ status: "created", appointmentId: "a" });
    await expect(repository.create({ tenantId: "tenant-a" as never }, {
      ...validInput,
      startAt: new Date(validInput.startAt.getTime() + 15 * 60_000),
      email: "other@example.com",
    })).resolves.toBe("slot_unavailable");

    const lockKeys = transaction.$executeRaw.mock.calls
      .filter((call) => String(call[0]).includes("pg_advisory_xact_lock"))
      .map((call) => call[1]);
    expect(lockKeys).toEqual(["tenant-a:staff-a", "tenant-a:staff-a"]);
    expect(transaction.appointment.create).toHaveBeenCalledOnce();
  });

  it("rejects past booking times before profile or appointment persistence", async () => {
    const transaction = makeTransaction();
    const previousMonday = new Date(`${nextMondayIso()}T00:00:00.000Z`);
    previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
    const pastStartAt = localWallTimeToUtc(previousMonday.toISOString().slice(0, 10), 9 * 60, "Europe/Istanbul");
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, {
      ...validInput,
      startAt: pastStartAt,
    })).resolves.toBe("slot_unavailable");
    expect(transaction.profile.create).not.toHaveBeenCalled();
    expect(transaction.appointment.create).not.toHaveBeenCalled();
  });

  it("rejects a directly supplied resource identifier that is not owned by the tenant", async () => {
    const transaction = makeTransaction({
      service: null,
      staff: null,
    });
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, {
      ...validInput,
      serviceId: "tenant-b-service-id",
      staffId: "tenant-b-staff-id",
    })).resolves.toBe("invalid_resource");
    expect(transaction.appointment.create).not.toHaveBeenCalled();
    expect(transaction.profile.create).not.toHaveBeenCalled();
  });

  it("rejects inactive staff even when the identifier is supplied directly", async () => {
    const transaction = makeTransaction({
      staff: { id: "staff-a", status: "INACTIVE" },
    });
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("invalid_resource");
    expect(transaction.appointment.create).not.toHaveBeenCalled();
  });

  it("blocks booking when an overlapping appointment is CONFIRMED", async () => {
    const transaction = makeTransaction();
    const confirmedAppointment = {
      id: "a-confirmed", tenantId: "tenant-a", staffId: "staff-a", serviceId: "svc-a", customerProfileId: "c",
      startAt: validInput.startAt, endAt: new Date(validInput.startAt.getTime() + 75 * 60_000), status: "CONFIRMED" as const,
    };
    transaction.appointment.findMany.mockResolvedValueOnce([confirmedAppointment]);

    const repository = createPrismaPublicBookingRepository(makePrisma(transaction));
    await expect(repository.create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("slot_unavailable");
    expect(transaction.appointment.create).not.toHaveBeenCalled();
  });

  it("allows booking when overlapping appointments are CANCELLED or REJECTED", async () => {
    const transaction = makeTransaction();
    const inactiveAppointments = [
      {
        id: "a-cancelled", tenantId: "tenant-a", staffId: "staff-a", serviceId: "svc-a", customerProfileId: "c1",
        startAt: validInput.startAt, endAt: new Date(validInput.startAt.getTime() + 75 * 60_000), status: "CANCELLED" as const,
      },
      {
        id: "a-rejected", tenantId: "tenant-a", staffId: "staff-a", serviceId: "svc-a", customerProfileId: "c2",
        startAt: validInput.startAt, endAt: new Date(validInput.startAt.getTime() + 75 * 60_000), status: "REJECTED" as const,
      },
    ];
    transaction.appointment.findMany.mockResolvedValueOnce(inactiveAppointments);

    const repository = createPrismaPublicBookingRepository(makePrisma(transaction));
    await expect(repository.create({ tenantId: "tenant-a" as never }, validInput)).resolves.toEqual({ status: "created", appointmentId: "a" });
    expect(transaction.appointment.create).toHaveBeenCalledOnce();
  });

  describe("tenant status gate (WP-07)", () => {
    it("returns tenant_inactive from the in-tx FOR SHARE read before conflict checks or inserts", async () => {
      const transaction = makeTransaction({ tenantStatus: "INACTIVE" });
      await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("tenant_inactive");
      expect(transaction.appointment.findMany).not.toHaveBeenCalled();
      expect(transaction.profile.create).not.toHaveBeenCalled();
      expect(transaction.appointment.create).not.toHaveBeenCalled();
      expect(transaction.appointmentAccessToken.create).not.toHaveBeenCalled();
    });

    it("reads Tenant.status FOR SHARE with the context tenant id, after the advisory lock", async () => {
      const transaction = makeTransaction();
      await createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput);
      expect(transaction.$queryRaw).toHaveBeenCalledOnce();
      const [sql, tenantId] = transaction.$queryRaw.mock.calls[0];
      expect(String((sql as TemplateStringsArray).join("?"))).toMatch(/FROM "Tenant" WHERE "id" = \? FOR SHARE/);
      expect(tenantId).toBe("tenant-a");
      const lockCall = transaction.$executeRaw.mock.calls.findIndex((call) => String(call[0]).includes("pg_advisory_xact_lock"));
      expect(transaction.$executeRaw.mock.invocationCallOrder[lockCall]).toBeLessThan(transaction.$queryRaw.mock.invocationCallOrder[0]);
      expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.appointment.findMany.mock.invocationCallOrder[0]);
    });

    it("treats a missing tenant row as invalid_resource, distinct from tenant_inactive", async () => {
      const transaction = makeTransaction({ tenantStatus: null });
      await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("invalid_resource");
      expect(transaction.appointment.create).not.toHaveBeenCalled();
    });
  });

  describe("closed dates (WP-08)", () => {
    it("rejects a booking on a closed date as slot_unavailable, before conflict reads or inserts", async () => {
      const transaction = makeTransaction({ closures: [nextMondayIso()] });
      await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("slot_unavailable");
      expect(transaction.appointment.findMany).not.toHaveBeenCalled();
      expect(transaction.profile.create).not.toHaveBeenCalled();
      expect(transaction.appointment.create).not.toHaveBeenCalled();
      expect(transaction.appointmentAccessToken.create).not.toHaveBeenCalled();
    });

    it("reads closures after the FOR SHARE tenant read, on the same tenant-context tx", async () => {
      const transaction = makeTransaction();
      await createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput);
      expect(transaction.closureDate.findMany).toHaveBeenCalledOnce();
      expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.closureDate.findMany.mock.invocationCallOrder[0]);
      expect(transaction.closureDate.findMany.mock.invocationCallOrder[0]).toBeLessThan(transaction.appointment.findMany.mock.invocationCallOrder[0]);
      expect(transaction.closureDate.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", OR: [{ staffId: null }, { staffId: "staff-a" }] });
    });

    it("does not read closures for an inactive tenant", async () => {
      const transaction = makeTransaction({ tenantStatus: "INACTIVE" });
      await createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput);
      expect(transaction.closureDate.findMany).not.toHaveBeenCalled();
    });
  });
});

// QA (WP-08): public bookings stay PENDING; buffer crossing into a closed date is rejected in-tx.
describe("public booking QA additions (WP-08)", () => {
  it("inserts public bookings as PENDING (on-behalf CONFIRMED does not leak into the public path)", async () => {
    const transaction = makeTransaction();
    await createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput);
    expect(transaction.appointment.create.mock.calls[0][0].data.status).toBe("PENDING");
  });

  it("rejects in-tx when the buffer crosses local midnight into a closed next date", async () => {
    const monday = nextMondayIso();
    const tuesday = new Date(Date.parse(`${monday}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    const transaction = makeTransaction({ closures: [tuesday] });
    transaction.workingHours.findMany.mockResolvedValue([{ id: "wh", tenantId: "tenant-a", dayOfWeek: 1, openMinute: 540, closeMinute: 1440 }]);
    const startAt = localWallTimeToUtc(monday, 23 * 60, "Europe/Istanbul");
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, { ...validInput, startAt })).resolves.toBe("slot_unavailable");
    expect(transaction.appointment.create).not.toHaveBeenCalled();
    expect(transaction.appointmentAccessToken.create).not.toHaveBeenCalled();
  });
});
