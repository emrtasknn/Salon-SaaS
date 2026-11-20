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
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)),
  } as unknown as PrismaServiceClient;

  return { tx, prisma };
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
      where: { tenantId_id: { tenantId: "tenant-1", id: "service-1" }, deletedAt: null },
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
      where: { tenantId: "tenant-1", id: "service-1", deletedAt: null },
      data: { active: false },
    });
    expect(tx.service.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", deletedAt: null },
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

  it("does not update a service when the record is absent from the tenant", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findUnique.mockResolvedValue(null);

    await expect(
      createPrismaServiceRepository(prisma).update(tenantContext, "service-other", {
        name: "Intruder Name",
      }),
    ).resolves.toBe("not_found");

    expect(tx.service.findUnique).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "service-other" }, deletedAt: null },
    });
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("maps unique violations on update to conflict", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.update.mockRejectedValue({ code: "P2002" });

    await expect(
      createPrismaServiceRepository(prisma).update(tenantContext, "service-1", {
        name: "Existing Name",
      }),
    ).resolves.toBe("conflict");
  });

  const input = { name: "Haircut", durationMinutes: 60, bufferMinutes: 15 };

  it("create renames an archived holder of the name first, then creates", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findFirst.mockResolvedValue({ id: "old-1", deletedAt: new Date() });
    tx.service.findMany.mockResolvedValue([{ name: "Haircut (silindi)" }]);

    await expect(createPrismaServiceRepository(prisma).create(tenantContext, input)).resolves.toBe("created");

    expect(tx.service.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", name: "Haircut" },
      select: { id: true, deletedAt: true },
    });
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "old-1" } },
      data: { name: "Haircut (silindi 2)" },
    });
    expect(tx.service.update.mock.invocationCallOrder[0]).toBeLessThan(tx.service.create.mock.invocationCallOrder[0]);
    expect(tx.service.findMany.mock.calls[0][0].where.tenantId).toBe("tenant-1");
  });

  it("rename of a live service renames an archived holder first, then updates", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findFirst.mockResolvedValue({ id: "old-1", deletedAt: new Date() });

    await expect(
      createPrismaServiceRepository(prisma).update(tenantContext, "service-1", { name: "Color" }),
    ).resolves.toBe("updated");

    expect(tx.service.update).toHaveBeenNthCalledWith(1, {
      where: { tenantId_id: { tenantId: "tenant-1", id: "old-1" } },
      data: { name: "Color (silindi)" },
    });
    expect(tx.service.update).toHaveBeenNthCalledWith(2, {
      where: { tenantId_id: { tenantId: "tenant-1", id: "service-1" } },
      data: { name: "Color" },
    });
  });

  it("a name held by a live service is a conflict and renames nothing", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findFirst.mockResolvedValue({ id: "live-2", deletedAt: null });

    await expect(createPrismaServiceRepository(prisma).create(tenantContext, input)).resolves.toBe("conflict");
    await expect(
      createPrismaServiceRepository(prisma).update(tenantContext, "service-1", { name: "Haircut" }),
    ).resolves.toBe("conflict");

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.service.create).not.toHaveBeenCalled();
  });

  it("keeping its own name on update is not a conflict", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findFirst.mockResolvedValue({ id: "service-1", deletedAt: null });

    await expect(
      createPrismaServiceRepository(prisma).update(tenantContext, "service-1", { name: "Haircut" }),
    ).resolves.toBe("updated");
    expect(tx.service.update).toHaveBeenCalledTimes(1);
  });

  it("falls back to conflict when all archived names are exhausted", async () => {
    const { prisma, tx } = makePrisma();
    tx.service.findFirst.mockResolvedValue({ id: "old-1", deletedAt: new Date() });
    tx.service.findMany.mockImplementation(async (args: { where: { name: { in: string[] } } }) =>
      args.where.name.in.map((name) => ({ name })),
    );

    await expect(createPrismaServiceRepository(prisma).create(tenantContext, input)).resolves.toBe("conflict");
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.service.create).not.toHaveBeenCalled();
  });
});
