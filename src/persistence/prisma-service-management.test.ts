import { describe, expect, it, vi } from "vitest";
import { createPrismaServiceRepository, type PrismaServiceClient } from "./prisma-service-management";
import type { TenantContext } from "../domain/tenant-context";

const tenantContext = { tenantId: "tenant-1" } as TenantContext;

function makePrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    service: {
      create: vi.fn().mockResolvedValue({
        id: "service-1",
        tenantId: "tenant-1",
        name: "Haircut",
        durationMinutes: 60,
        bufferMinutes: 15,
        active: true,
      }),
      update: vi.fn().mockResolvedValue({
        id: "service-1",
        tenantId: "tenant-1",
        name: "Haircut",
        durationMinutes: 60,
        bufferMinutes: 15,
        active: true,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        id: "service-1",
        tenantId: "tenant-1",
        name: "Haircut",
        durationMinutes: 60,
        bufferMinutes: 15,
        active: true,
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)),
    },
  };
}

describe("prisma service repository", () => {
  it("sets tenant context before a service write and scopes the write", async () => {
    const { prisma, tx } = makePrisma();
    const result = await createPrismaServiceRepository(prisma).create(tenantContext, {
      name: "Haircut",
      durationMinutes: 60,
      bufferMinutes: 15,
    });

    expect(result).toBe("created");
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.service.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        name: "Haircut",
        durationMinutes: 60,
        bufferMinutes: 15,
        active: true,
      },
    });
  });

  it("uses tenant composite identity for updates", async () => {
    const { prisma, tx } = makePrisma();
    await createPrismaServiceRepository(prisma).update(tenantContext, "service-1", {
      durationMinutes: 75,
    });

    expect(tx.service.findUnique).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "service-1" } },
    });
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "service-1" } },
      data: { durationMinutes: 75 },
    });
  });

  it("scopes status changes and list operations to the tenant", async () => {
    const { prisma, tx } = makePrisma();
    await createPrismaServiceRepository(prisma).setActive(tenantContext, "service-1", false);
    await createPrismaServiceRepository(prisma).list(tenantContext);

    expect(tx.service.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", id: "service-1" },
      data: { active: false },
    });
    expect(tx.service.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1" },
      orderBy: { name: "asc" },
    });
  });

  it("maps unique violations to conflict", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.create.mockRejectedValue({ code: "P2002" });

    await expect(
      createPrismaServiceRepository(prisma).create(tenantContext, {
        name: "Haircut",
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    ).resolves.toBe("conflict");
  });
});
