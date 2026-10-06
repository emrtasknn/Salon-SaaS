import { describe, expect, it, vi } from "vitest";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import type { PrismaTenantClient } from "./prisma-tenant-context";

describe("prisma booking repository", () => {
  it("uses tenant context and an advisory lock before final conflict check", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const transaction = {
      $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() },
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: "t", timezone: "Europe/Istanbul" }) },
      service: { findUnique: vi.fn().mockResolvedValue({ id: "svc", tenantId: "t", name: "Cut", durationMinutes: 60, bufferMinutes: 15, active: true }) },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: "s", tenantId: "t", profileId: "p", status: "ACTIVE" }) },
      workingHours: { findMany: vi.fn().mockResolvedValue([]) },
      appointment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)) } as unknown as PrismaTenantClient;
    const repository = createPrismaBookingRepository(prisma);
    await expect(repository.createAppointment({ tenantId: "t" as never }, {
      staffId: "s", serviceId: "svc", customerProfileId: "c",
      startAt: new Date("2026-10-05T06:00:00.000Z"), endAt: new Date("2026-10-05T07:15:00.000Z"),
    })).resolves.toBe("created");
    expect(executeRaw).toHaveBeenCalled();
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it("maps invalid transition without writing", async () => {
    const transaction = { $executeRaw: vi.fn(), tenantMembership: { findUnique: vi.fn() }, appointment: { updateMany: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)) } as unknown as PrismaTenantClient;
    const repository = createPrismaBookingRepository(prisma);
    await expect(repository.transition({ tenantId: "t" as never }, "a", "REJECTED", "CONFIRMED")).resolves.toBe("invalid_transition");
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });
});
