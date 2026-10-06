import { describe, expect, it, vi } from "vitest";
import { createPrismaWorkingHoursRepository } from "./prisma-working-hours-management";
import type { PrismaTenantClient } from "./prisma-tenant-context";

describe("prisma working hours repository", () => {
  it("sets tenant context and reports create/update lifecycle", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const upsert = vi.fn().mockResolvedValue({ id: "wh_1", tenantId: "tenant_1", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const tx = { $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() }, workingHours: { findUnique, upsert, deleteMany: vi.fn(), findMany: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: any) => callback(tx)) } as unknown as PrismaTenantClient;
    const repository = createPrismaWorkingHoursRepository(prisma);
    await expect(repository.upsert({ tenantId: "tenant_1" as never }, { dayOfWeek: 1, openMinute: 540, closeMinute: 1080 })).resolves.toBe("created");
    expect(executeRaw).toHaveBeenCalled();
  });

  it("removes and lists within tenant", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "wh_1", tenantId: "tenant_1", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]);
    const tx = { $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() }, workingHours: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany, findMany } };
    const prisma = { $transaction: vi.fn(async (callback: any) => callback(tx)) } as unknown as PrismaTenantClient;
    const repository = createPrismaWorkingHoursRepository(prisma);
    await expect(repository.remove({ tenantId: "tenant_1" as never }, 1)).resolves.toBe("removed");
    await expect(repository.list({ tenantId: "tenant_1" as never })).resolves.toHaveLength(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { tenantId: "tenant_1", dayOfWeek: 1 } });
    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: "tenant_1" }, orderBy: { dayOfWeek: "asc" } });
  });
});
