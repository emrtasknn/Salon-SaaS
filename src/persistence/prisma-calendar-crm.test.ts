import { describe, expect, it, vi } from "vitest";
import { createPrismaCalendarCrmRepository } from "./prisma-calendar-crm";

describe("prisma calendar crm repository", () => {
  it("scopes calendar queries by tenant and time", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const appointment = { findMany: vi.fn().mockResolvedValue([]) };
    const tx = { $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() }, appointment,
      profile: { findUnique: vi.fn() }, customerNote: { findMany: vi.fn(), create: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)) };
    await createPrismaCalendarCrmRepository(prisma).listAppointments({ tenantId: "t" as never }, {
      startAt: new Date("2026-10-05T00:00:00Z"), endAt: new Date("2026-10-06T00:00:00Z"),
    });
    expect(executeRaw).toHaveBeenCalled();
    expect(appointment.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t", startAt: { lt: new Date("2026-10-06T00:00:00Z") }, endAt: { gt: new Date("2026-10-05T00:00:00Z") } },
      orderBy: { startAt: "asc" },
    });
  });
});
