import { describe, expect, it, vi } from "vitest";
import { createPrismaAppointmentDeletionRepository } from "./prisma-appointment-deletion";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const tenant = { tenantId: "t" as never };
const at = new Date("2026-11-16T12:00:00.000Z");
const row = {
  id: "a1", tenantId: "t", staffId: "s", serviceId: "sv", customerProfileId: "c",
  startAt: new Date("2026-11-20T10:00:00.000Z"), endAt: new Date("2026-11-20T10:30:00.000Z"), status: "CANCELLED",
};

function makeTx(overrides: { count?: number; findFirst?: unknown } = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
    tenantMembership: { findUnique: vi.fn() },
    appointment: {
      findFirst: vi.fn().mockResolvedValue(overrides.findFirst === undefined ? row : overrides.findFirst),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.count ?? 1 }),
    },
  };
}

function prismaFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return prisma;
}

describe("prisma appointment deletion", () => {
  it("find excludes archived appointments and is tenant scoped", async () => {
    const tx = makeTx();
    await expect(createPrismaAppointmentDeletionRepository(prismaFor(tx)).find(tenant, "a1")).resolves.toEqual(row);
    expect(tx.appointment.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", id: "a1", deletedAt: null });
  });

  it("find returns null when missing", async () => {
    const tx = makeTx({ findFirst: null });
    await expect(createPrismaAppointmentDeletionRepository(prismaFor(tx)).find(tenant, "a1")).resolves.toBeNull();
  });

  it("archive updates only terminal, non-archived rows", async () => {
    const tx = makeTx();
    await expect(createPrismaAppointmentDeletionRepository(prismaFor(tx)).archive(tenant, "a1", at)).resolves.toBe("archived");
    expect(tx.appointment.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t", id: "a1", deletedAt: null, status: { in: ["REJECTED", "CANCELLED", "COMPLETED"] } },
      data: { deletedAt: at },
    });
    expect(tx.appointment.findFirst).not.toHaveBeenCalled();
  });

  it("archive distinguishes not_found from not_terminal when nothing updated", async () => {
    const missing = makeTx({ count: 0, findFirst: null });
    await expect(createPrismaAppointmentDeletionRepository(prismaFor(missing)).archive(tenant, "a1", at)).resolves.toBe("not_found");
    expect(missing.appointment.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", id: "a1", deletedAt: null });
    const active = makeTx({ count: 0, findFirst: { ...row, status: "CONFIRMED" } });
    await expect(createPrismaAppointmentDeletionRepository(prismaFor(active)).archive(tenant, "a1", at)).resolves.toBe("not_terminal");
  });
});
