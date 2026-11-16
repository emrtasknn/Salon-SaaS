import { describe, expect, it, vi } from "vitest";
import { createPrismaServiceDeletionRepository } from "./prisma-service-deletion";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const tenant = { tenantId: "t" as never };
const now = new Date("2026-11-16T12:00:00.000Z");
const input = { serviceId: "sv1", now };

function makeTx(o: { service?: unknown; count?: number } = {}) {
  const calls: string[] = [];
  const track = <T,>(name: string, value: T) => vi.fn().mockImplementation(async () => { calls.push(name); return value; });
  return {
    calls,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockImplementation(async () => { calls.push("lock"); return [{ id: "t" }]; }),
    service: {
      findFirst: track("service.find", o.service === undefined ? { id: "sv1" } : o.service),
      update: track("service.update", {}),
    },
    appointment: { count: track("appointment.count", o.count ?? 0) },
    staffService: { deleteMany: track("staffService.delete", { count: 1 }) },
  };
}

function repoFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return createPrismaServiceDeletionRepository(prisma);
}

const WRITES = ["service.update", "staffService.delete"];

describe("prisma service deletion", () => {
  it("locks tenant, reads, counts, then writes in order", async () => {
    const tx = makeTx();
    await expect(repoFor(tx).archive(tenant, input)).resolves.toBe("archived");
    expect(tx.calls).toEqual(["lock", "service.find", "appointment.count", ...WRITES]);
  });

  it("counts future active appointments by serviceId or AppointmentService link, once each", async () => {
    const tx = makeTx();
    await repoFor(tx).archive(tenant, input);
    expect(tx.appointment.count).toHaveBeenCalledWith({
      where: {
        tenantId: "t",
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { gt: now },
        deletedAt: null,
        OR: [{ serviceId: "sv1" }, { services: { some: { tenantId: "t", serviceId: "sv1" } } }],
      },
    });
    expect(tx.service.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", id: "sv1", deletedAt: null });
  });

  it("issues both writes scoped by tenantId", async () => {
    const tx = makeTx();
    await repoFor(tx).archive(tenant, input);
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "t", id: "sv1" } }, data: { deletedAt: now, active: false },
    });
    expect(tx.staffService.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", serviceId: "sv1" } });
  });

  it.each([
    ["not_found", { service: null }, "not_found"],
    ["has_active_appointments", { count: 2 }, { status: "has_active_appointments", count: 2 }],
  ] as const)("performs no write when %s", async (_name, setup, expected) => {
    const tx = makeTx(setup as never);
    await expect(repoFor(tx).archive(tenant, input)).resolves.toEqual(expected);
    expect(tx.calls.filter((c) => WRITES.includes(c))).toEqual([]);
  });
});
