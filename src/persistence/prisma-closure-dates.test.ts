import { describe, expect, it, vi } from "vitest";
import { createPrismaClosureDateRepository } from "./prisma-closure-dates";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const tenant = { tenantId: "t" as never };
const now = new Date("2026-11-04T09:00:00.000Z");

function makeTx(overrides: { tenantRows?: unknown[]; existing?: unknown; impact?: unknown[] } = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(overrides.tenantRows ?? [{ timezone: "Europe/Istanbul" }]),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ timezone: "Europe/Istanbul" }) },
    closureDate: {
      findMany: vi.fn().mockResolvedValue([{ id: "c1", date: new Date("2026-11-09T00:00:00.000Z"), reason: null }]),
      findFirst: vi.fn().mockResolvedValue(overrides.existing ?? null),
      create: vi.fn().mockResolvedValue({ id: "c2", date: new Date("2026-11-09T00:00:00.000Z"), reason: "Bayram" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    appointment: { findMany: vi.fn().mockResolvedValue(overrides.impact ?? []) },
  };
}

function prismaFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return prisma;
}

const input = { date: "2026-11-09", reason: "Bayram", createdByProfileId: "admin", confirmExistingAppointments: false, now };
const impactRow = {
  id: "a1", startAt: new Date("2026-11-09T07:30:00.000Z"), status: "PENDING",
  staff: { profile: { displayName: "Ali" } }, customerProfile: { displayName: "Ayse" },
};

describe("prisma closure dates (WP-08)", () => {
  it("runs every operation inside the tenant-context transaction", async () => {
    const tx = makeTx();
    const repository = createPrismaClosureDateRepository(prismaFor(tx));
    await repository.list(tenant, { from: "2026-11-01", to: "2026-11-30" });
    await repository.impact(tenant, "2026-11-09");
    await repository.create(tenant, input);
    await repository.delete(tenant, "c1");
    const setConfigCalls = tx.$executeRaw.mock.calls.filter((call) => String(call[0]).includes("set_config"));
    expect(setConfigCalls).toHaveLength(4);
    expect(setConfigCalls.every((call) => call[1] === "t")).toBe(true);
  });

  it("lists tenant-wide closures in the range as local date strings", async () => {
    const tx = makeTx();
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).list(tenant, { from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual({
      timezone: "Europe/Istanbul", closures: [{ id: "c1", date: "2026-11-09", reason: null }],
    });
    expect(tx.closureDate.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "t", staffId: null, date: { gte: new Date("2026-11-01T00:00:00.000Z"), lte: new Date("2026-11-30T00:00:00.000Z") },
    });
  });

  it("impact: PENDING/CONFIRMED appointments overlapping the local day (incl. ones starting the evening before)", async () => {
    const tx = makeTx({ impact: [impactRow] });
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).impact(tenant, "2026-11-09")).resolves.toEqual({
      timezone: "Europe/Istanbul",
      appointments: [{ id: "a1", startAt: impactRow.startAt, status: "PENDING", staffName: "Ali", customerName: "Ayse" }],
    });
    expect(tx.appointment.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "t", status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { lt: new Date("2026-11-09T21:00:00.000Z") },
      endAt: { gt: new Date("2026-11-08T21:00:00.000Z") },
    });
  });

  it("create: locks the Tenant row FOR UPDATE first, then checks duplicate, impact, and inserts", async () => {
    const tx = makeTx();
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).create(tenant, input)).resolves.toEqual({
      status: "created", closure: { id: "c2", date: "2026-11-09", reason: "Bayram" },
    });
    const [sql, tenantId] = tx.$queryRaw.mock.calls[0];
    expect(String((sql as TemplateStringsArray).join("?"))).toMatch(/FROM "Tenant" WHERE "id" = \? FOR UPDATE/);
    expect(tenantId).toBe("t");
    const order = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.closureDate.findFirst.mock.invocationCallOrder[0],
      tx.appointment.findMany.mock.invocationCallOrder[0],
      tx.closureDate.create.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(tx.closureDate.findFirst).toHaveBeenCalledWith({ where: { tenantId: "t", staffId: null, date: new Date("2026-11-09T00:00:00.000Z") }, select: { id: true } });
    expect(tx.closureDate.create).toHaveBeenCalledWith({
      data: { tenantId: "t", staffId: null, date: new Date("2026-11-09T00:00:00.000Z"), reason: "Bayram", createdByProfileId: "admin" },
      select: { id: true, date: true, reason: true },
    });
  });

  it("create: duplicate tenant-wide closure is rejected without insert", async () => {
    const tx = makeTx({ existing: { id: "c1" } });
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).create(tenant, input)).resolves.toBe("duplicate");
    expect(tx.closureDate.create).not.toHaveBeenCalled();
  });

  it("create: existing appointments require confirmation; confirmed inserts without touching appointments", async () => {
    const tx = makeTx({ impact: [impactRow] });
    const repository = createPrismaClosureDateRepository(prismaFor(tx));
    await expect(repository.create(tenant, input)).resolves.toMatchObject({ status: "has_appointments", timezone: "Europe/Istanbul" });
    expect(tx.closureDate.create).not.toHaveBeenCalled();
    await expect(repository.create(tenant, { ...input, confirmExistingAppointments: true })).resolves.toMatchObject({ status: "created" });
    expect(tx.closureDate.create).toHaveBeenCalledOnce();
    // Only reads on Appointment: no auto-cancel (decision d).
    expect(Object.keys(tx.appointment)).toEqual(["findMany"]);
  });

  it("create: past local date rejected, today allowed, missing tenant -> not_found", async () => {
    await expect(createPrismaClosureDateRepository(prismaFor(makeTx())).create(tenant, { ...input, date: "2026-11-03" })).resolves.toBe("past_date");
    await expect(createPrismaClosureDateRepository(prismaFor(makeTx())).create(tenant, { ...input, date: "2026-11-04" })).resolves.toMatchObject({ status: "created" });
    await expect(createPrismaClosureDateRepository(prismaFor(makeTx({ tenantRows: [] }))).create(tenant, input)).resolves.toBe("not_found");
  });

  it("delete: tenant-wide row of this tenant only", async () => {
    const tx = makeTx();
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).delete(tenant, "c1")).resolves.toBe("deleted");
    expect(tx.closureDate.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", id: "c1", staffId: null } });
    tx.closureDate.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(createPrismaClosureDateRepository(prismaFor(tx)).delete(tenant, "c9")).resolves.toBe("not_found");
  });
});
