import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import type { PrismaTenantClient } from "./prisma-tenant-context";

function makeRepository(timeZone: string) {
  const appointmentFindMany = vi.fn().mockResolvedValue([]);
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: "tenant-a", timezone: timeZone }) },
    service: { findUnique: vi.fn().mockResolvedValue({ id: "service-a", durationMinutes: 30, bufferMinutes: 0, active: true }) },
    staff: { findUnique: vi.fn().mockResolvedValue({ id: "staff-a", status: "ACTIVE" }) },
    workingHours: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findMany: appointmentFindMany },
  };
  const prisma = { $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)) } as unknown as PrismaTenantClient;
  return { repository: createPrismaPublicAvailabilityRepository(prisma), appointmentFindMany };
}

describe("public availability local day boundaries", () => {
  it.each([
    { dateIso: "2026-03-08", timeZone: "America/New_York", start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" },
    { dateIso: "2026-11-01", timeZone: "America/New_York", start: "2026-11-01T04:00:00.000Z", end: "2026-11-02T05:00:00.000Z" },
  ])("queries appointments across the complete local day for $dateIso ($timeZone)", async ({ dateIso, timeZone, start, end }) => {
    const { repository, appointmentFindMany } = makeRepository(timeZone);

    await repository.read({ tenantId: "tenant-a" as never }, { serviceId: "service-a", staffId: "staff-a", dateIso });

    expect(appointmentFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        staffId: "staff-a",
        startAt: { lt: new Date(end) },
        endAt: { gt: new Date(start) },
      },
    });
  });
});
