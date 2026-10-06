import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicBookingRepository } from "./prisma-public-booking";

describe("public booking repository", () => {
  it("uses tenant context, advisory lock and creates a pending appointment", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0), tenantMembership: { findUnique: vi.fn() },
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: "t", timezone: "Europe/Istanbul" }) },
      workingHours: { findMany: vi.fn().mockResolvedValue([{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]) },
      service: { findUnique: vi.fn().mockResolvedValue({ id: "svc", durationMinutes: 60, bufferMinutes: 15, active: true }) },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: "staff", status: "ACTIVE" }) },
      profile: { findUnique: vi.fn().mockResolvedValue({ id: "c" }), create: vi.fn() },
      appointment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "a" }) },
    };
    const prisma = { $transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(createPrismaPublicBookingRepository(prisma).create({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", startAt: new Date("2026-10-05T06:00:00Z"),
      displayName: "Customer", email: "c@example.com", phone: null,
    })).resolves.toBe("created");
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});
