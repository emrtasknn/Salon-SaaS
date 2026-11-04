import { describe, expect, it, vi } from "vitest";
import { createPrismaInAppNotificationRepository } from "./prisma-in-app-notifications";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const since = new Date("2026-10-28T12:00:00.000Z");
const options = { since, pendingLimit: 20, recentLimit: 20 };
const tenant = { tenantId: "tenant-a" as never };

const pendingRow = {
  id: "appointment-pending",
  status: "PENDING" as const,
  startAt: new Date("2026-11-05T09:00:00.000Z"),
  updatedAt: new Date("2026-11-04T10:00:00.000Z"),
  staff: { profile: { displayName: "Merve" } },
  service: { name: "Saç kesimi" },
  customerProfile: { displayName: "Ada" },
};
const recentRow = {
  id: "appointment-recent",
  status: "CANCELLED" as const,
  startAt: new Date("2026-11-06T09:00:00.000Z"),
  updatedAt: new Date("2026-11-03T08:30:00.000Z"),
  staff: { profile: { displayName: "Merve" } },
  service: { name: "Sakal" },
  customerProfile: { displayName: "Ada" },
};

function setup() {
  const executeRaw = vi.fn().mockResolvedValue(0);
  const appointment = {
    count: vi.fn().mockResolvedValue(37),
    findMany: vi.fn()
      .mockResolvedValueOnce([pendingRow])
      .mockResolvedValueOnce([recentRow]),
  };
  const transaction = {
    $executeRaw: executeRaw,
    tenantMembership: { findUnique: vi.fn() },
    appointment,
  };
  const $transaction = vi.fn(
    async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction),
  );
  const prisma = { $transaction } as unknown as PrismaTenantClient;
  return { executeRaw, appointment, $transaction, repository: createPrismaInAppNotificationRepository(prisma) };
}

function selectContainsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([entryKey, entry]) => entryKey === key || selectContainsKey(entry, key));
}

const baseSelect = {
  id: true,
  status: true,
  startAt: true,
  updatedAt: true,
  staff: { select: { profile: { select: { displayName: true } } } },
  service: { select: { name: true } },
};

describe("prisma in-app notification repository", () => {
  it("sets tenant context first inside a single transaction", async () => {
    const { executeRaw, appointment, $transaction, repository } = setup();
    await repository.read(tenant, { kind: "tenant" }, options);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [query, ...values] = executeRaw.mock.calls[0];
    expect((query as TemplateStringsArray).join("?")).toContain("set_config('app.tenant_id'");
    expect(values).toEqual(["tenant-a"]);

    const firstSetConfig = executeRaw.mock.invocationCallOrder[0];
    for (const order of [...appointment.count.mock.invocationCallOrder, ...appointment.findMany.mock.invocationCallOrder]) {
      expect(firstSetConfig).toBeLessThan(order);
    }
  });

  it("scopes tenant (admin) queries by tenantId only and selects customer display name", async () => {
    const { appointment, repository } = setup();
    const result = await repository.read(tenant, { kind: "tenant" }, options);

    expect(appointment.count).toHaveBeenCalledTimes(1);
    expect(appointment.count).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", status: "PENDING" } });

    expect(appointment.findMany).toHaveBeenCalledTimes(2);
    const tenantSelect = { ...baseSelect, customerProfile: { select: { displayName: true } } };
    expect(appointment.findMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: "tenant-a", status: "PENDING" },
      orderBy: { startAt: "asc" },
      take: 20,
      select: tenantSelect,
    });
    expect(appointment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: "tenant-a",
        status: { in: ["CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED"] },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: tenantSelect,
    });

    for (const call of [...appointment.count.mock.calls, ...appointment.findMany.mock.calls]) {
      expect(call[0].where).not.toHaveProperty("staffId");
    }

    expect(result).toEqual({
      pendingCount: 37,
      pending: [{
        appointmentId: "appointment-pending",
        kind: "PENDING_REQUEST",
        status: "PENDING",
        startAt: pendingRow.startAt,
        updatedAt: pendingRow.updatedAt,
        serviceName: "Saç kesimi",
        staffDisplayName: "Merve",
        customerDisplayName: "Ada",
      }],
      recent: [{
        appointmentId: "appointment-recent",
        kind: "STATUS_CHANGED",
        status: "CANCELLED",
        startAt: recentRow.startAt,
        updatedAt: recentRow.updatedAt,
        serviceName: "Sakal",
        staffDisplayName: "Merve",
        customerDisplayName: "Ada",
      }],
    });
  });

  it("adds staffId to every where for staff scope and never selects customer data", async () => {
    const { appointment, repository } = setup();
    const result = await repository.read(tenant, { kind: "staff", staffId: "staff-a" }, options);

    expect(appointment.count).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", staffId: "staff-a", status: "PENDING" },
    });
    expect(appointment.findMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: "tenant-a", staffId: "staff-a", status: "PENDING" },
      orderBy: { startAt: "asc" },
      take: 20,
      select: baseSelect,
    });
    expect(appointment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: "tenant-a",
        staffId: "staff-a",
        status: { in: ["CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED"] },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: baseSelect,
    });
    for (const call of appointment.findMany.mock.calls) {
      expect(selectContainsKey(call[0].select, "customerProfile")).toBe(false);
    }
    // Even if the row carried a customer relation, staff items must not expose it.
    for (const item of [...result.pending, ...result.recent]) {
      expect(item).not.toHaveProperty("customerDisplayName");
    }
  });

  it("passes the caller's limits through as take", async () => {
    const { appointment, repository } = setup();
    await repository.read(tenant, { kind: "tenant" }, { since, pendingLimit: 5, recentLimit: 7 });
    expect(appointment.findMany.mock.calls[0][0].take).toBe(5);
    expect(appointment.findMany.mock.calls[1][0].take).toBe(7);
    expect(appointment.count.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it.each([
    ["tenant", { kind: "tenant" as const }],
    ["staff", { kind: "staff" as const, staffId: "staff-a" }],
  ])("every where has tenantId and no select contains email/phone (%s scope)", async (_label, scope) => {
    const { appointment, repository } = setup();
    await repository.read(tenant, scope, options);
    const calls = [...appointment.count.mock.calls, ...appointment.findMany.mock.calls];
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[0].where.tenantId).toBe("tenant-a");
    }
    for (const call of appointment.findMany.mock.calls) {
      expect(selectContainsKey(call[0].select, "email")).toBe(false);
      expect(selectContainsKey(call[0].select, "phone")).toBe(false);
      expect(call[0]).not.toHaveProperty("include");
    }
  });

  it("propagates query failures so the service can map them to PERSISTENCE_FAILURE", async () => {
    const { appointment, repository } = setup();
    appointment.count.mockRejectedValueOnce(new Error("db down"));
    await expect(repository.read(tenant, { kind: "tenant" }, options)).rejects.toThrow("db down");
  });
});
