import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";
import type { PrismaTenantClient } from "./prisma-tenant-context";

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
    service: { findUnique: vi.fn().mockResolvedValue(overrides.service ?? { id: "svc-a", durationMinutes: 60, bufferMinutes: 15, active: true }) },
    staff: { findUnique: vi.fn().mockResolvedValue(overrides.staff ?? { id: "staff-a", status: "ACTIVE" }) },
    profile: { findUnique: vi.fn().mockResolvedValue(overrides.profile ?? { id: "c" }), create: vi.fn() },
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
  startAt: new Date("2026-10-05T06:00:00Z"),
  displayName: "Customer",
  email: "c@example.com",
  phone: null,
};

describe("public booking repository", () => {
  it("uses tenant context, advisory lock and creates a pending appointment", async () => {
    const transaction = makeTransaction();
    await expect(createPrismaPublicBookingRepository(makePrisma(transaction)).create({ tenantId: "tenant-a" as never }, validInput)).resolves.toBe("created");
    expect(transaction.$executeRaw).toHaveBeenCalled();
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
});
