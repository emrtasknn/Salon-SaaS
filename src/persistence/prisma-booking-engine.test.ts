import { describe, expect, it, vi } from "vitest";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import type { PrismaTenantClient } from "./prisma-tenant-context";

describe("prisma booking repository", () => {
  it("serializes overlapping booking attempts for the same tenant and staff", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const existingAppointment = {
      id: "existing", tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "other",
      startAt: new Date("2026-10-26T06:00:00.000Z"), endAt: new Date("2026-10-26T07:15:00.000Z"), status: "PENDING" as const,
    };
    const findConflicts = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([existingAppointment]);
    const tx = {
      $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() },
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: "t", timezone: "Europe/Istanbul" }) },
      service: { findUnique: vi.fn().mockResolvedValue({ id: "svc", tenantId: "t", name: "Cut", durationMinutes: 60, bufferMinutes: 15, active: true }) },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: "s", tenantId: "t", profileId: "p", status: "ACTIVE" }) },
      workingHours: { findMany: vi.fn().mockResolvedValue([]) },
      appointment: { findMany: findConflicts, create: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
    const repository = createPrismaBookingRepository(prisma);

    await expect(repository.createAppointment({ tenantId: "t" as never }, {
      staffId: "s", serviceId: "svc", customerProfileId: "c",
      startAt: new Date("2026-10-26T06:00:00.000Z"), endAt: new Date("2026-10-26T07:15:00.000Z"),
    })).resolves.toBe("created");

    // The second start time overlaps the first appointment; it must use the same per-staff lock and reject the conflict.
    await expect(repository.createAppointment({ tenantId: "t" as never }, {
      staffId: "s", serviceId: "svc", customerProfileId: "c",
      startAt: new Date("2026-10-26T06:15:00.000Z"), endAt: new Date("2026-10-26T07:30:00.000Z"),
    })).resolves.toBe("conflict");

    const lockKeys = executeRaw.mock.calls.map((call) => call[1]);
    expect(lockKeys).toEqual(["t:s", "t:s"]);
    expect(tx.appointment.create).toHaveBeenCalledOnce();
  });

  it("maps invalid transition without writing", async () => {
    const tx = { $executeRaw: vi.fn(), tenantMembership: { findUnique: vi.fn() }, appointment: { updateMany: vi.fn() } };
    const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
    const repository = createPrismaBookingRepository(prisma);
    await expect(repository.transition({ tenantId: "t" as never }, "a", "REJECTED", "CONFIRMED")).resolves.toBe("invalid_transition");
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });
});
