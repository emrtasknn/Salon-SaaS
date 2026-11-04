import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicAvailabilityRepository } from "./prisma-public-availability";
import type { PrismaTenantClient } from "./prisma-tenant-context";

function makeRepository(timeZone: string, tenantStatus: "ACTIVE" | "INACTIVE" = "ACTIVE", closures: string[] = []) {
  const appointmentFindMany = vi.fn().mockResolvedValue([]);
  const closureFindMany = vi.fn().mockResolvedValue(closures.map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })));
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: "tenant-a", timezone: timeZone, status: tenantStatus }) },
    service: { findUnique: vi.fn().mockResolvedValue({ id: "service-a", durationMinutes: 30, bufferMinutes: 0, active: true }) },
    staff: { findUnique: vi.fn().mockResolvedValue({ id: "staff-a", status: "ACTIVE" }) },
    workingHours: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findMany: appointmentFindMany },
    closureDate: { findMany: closureFindMany },
  };
  const prisma = { $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)) } as unknown as PrismaTenantClient;
  return { repository: createPrismaPublicAvailabilityRepository(prisma), appointmentFindMany, closureFindMany };
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

describe("public availability tenant status (WP-07)", () => {
  it("returns tenant_inactive without reading appointments for an inactive salon", async () => {
    const { repository, appointmentFindMany } = makeRepository("Europe/Istanbul", "INACTIVE");

    await expect(repository.read({ tenantId: "tenant-a" as never }, { serviceId: "service-a", staffId: "staff-a", dateIso: "2026-11-05" }))
      .resolves.toEqual({ status: "tenant_inactive" });
    expect(appointmentFindMany).not.toHaveBeenCalled();
  });
});

describe("public availability closed dates (WP-08)", () => {
  it("reads closures for the day and the next one inside the tenant-context tx and returns them", async () => {
    const { repository, closureFindMany } = makeRepository("Europe/Istanbul", "ACTIVE", ["2026-11-09"]);
    const result = await repository.read({ tenantId: "tenant-a" as never }, { serviceId: "service-a", staffId: "staff-a", dateIso: "2026-11-09" });
    expect(result).toMatchObject({ status: "ok", closedDates: ["2026-11-09"] });
    expect(closureFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        date: { in: [new Date("2026-11-09T00:00:00.000Z"), new Date("2026-11-10T00:00:00.000Z")] },
        OR: [{ staffId: null }, { staffId: "staff-a" }],
      },
      select: { date: true },
    });
  });

  it("does not read closures for an inactive salon", async () => {
    const { repository, closureFindMany } = makeRepository("Europe/Istanbul", "INACTIVE");
    await repository.read({ tenantId: "tenant-a" as never }, { serviceId: "service-a", staffId: "staff-a", dateIso: "2026-11-09" });
    expect(closureFindMany).not.toHaveBeenCalled();
  });
});
