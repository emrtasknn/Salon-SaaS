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
      $executeRaw: executeRaw, $queryRaw: vi.fn().mockResolvedValue([{ status: "ACTIVE" }]), tenantMembership: { findUnique: vi.fn() },
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

    const lockKeys = executeRaw.mock.calls
      .filter((call) => String(call[0]).includes("pg_advisory_xact_lock"))
      .map((call) => call[1]);
    expect(lockKeys).toEqual(["t:s", "t:s"]);
    expect(tx.appointment.create).toHaveBeenCalledOnce();
  });

  it("returns tenant_inactive from the in-tx FOR SHARE read before conflict checks or inserts (WP-07)", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ status: "INACTIVE" }]);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: queryRaw, tenantMembership: { findUnique: vi.fn() },
      service: { findUnique: vi.fn().mockResolvedValue({ id: "svc", tenantId: "t", name: "Cut", durationMinutes: 60, bufferMinutes: 15, active: true }) },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: "s", tenantId: "t", profileId: "p", status: "ACTIVE" }) },
      appointment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));

    await expect(createPrismaBookingRepository(prisma).createAppointment({ tenantId: "t" as never }, {
      staffId: "s", serviceId: "svc", customerProfileId: "c",
      startAt: new Date("2026-10-26T06:00:00.000Z"), endAt: new Date("2026-10-26T07:15:00.000Z"),
    })).resolves.toBe("tenant_inactive");
    expect(String((queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?"))).toMatch(/FROM "Tenant" WHERE "id" = \? FOR SHARE/);
    expect(queryRaw.mock.calls[0][1]).toBe("t");
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
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
