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
}> = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: "tenant-a", timezone: "Europe/Istanbul" }) },
    workingHours: { findMany: vi.fn().mockResolvedValue([{ id: "wh", tenantId: "tenant-a", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]) },
    service: { findUnique: vi.fn().mockResolvedValue(overrides.service !== undefined ? overrides.service : { id: "svc-a", durationMinutes: 60, bufferMinutes: 15, active: true }) },
    staff: { findUnique: vi.fn().mockResolvedValue(overrides.staff !== undefined ? overrides.staff : { id: "staff-a", status: "ACTIVE" }) },
    profile: { findUnique: vi.fn().mockResolvedValue(overrides.profile !== undefined ? overrides.profile : { id: "c" }), create: vi.fn() },
    appointment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "a" }) },
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
};

describe("public booking repository", () => {
  it("uses tenant context, advisory lock and creates a pending appointment", async () => {
    const transaction = makeTransaction();
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toEqual({ status: "created", appointmentId: "a" });
    expect(transaction.$executeRaw).toHaveBeenCalled();
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
    await expect(repository.create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("created");
    expect(transaction.appointment.create).toHaveBeenCalledOnce();
  });
});
