import { describe, expect, it, vi } from "vitest";
import {
  createPrismaWhatsAppIntegrationProvisioningRepository,
  type PrismaWhatsAppIntegrationProvisioningClient,
} from "./prisma-whatsapp-integration-provisioning";

function makeTx(overrides: Readonly<{
  create?: unknown;
}> = {}) {
  const createMock = overrides.create ?? vi.fn().mockResolvedValue({ id: "whatsapp-integration-1" });
  const whatsappIntegration = { create: createMock };
  const txClient = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    tenantMembership: { findUnique: vi.fn() },
    whatsappIntegration,
  };
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(txClient),
  );
  return { transaction, whatsappIntegration, txClient };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaWhatsAppIntegrationProvisioningClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) =>
    (callback as (tx: unknown) => Promise<unknown>)(tx.txClient),
  );
  return prisma;
}

describe("prisma whatsapp integration provisioning repository", () => {
  it("creates a record inside the tenant transaction context", async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const repository = createPrismaWhatsAppIntegrationProvisioningRepository(prisma);

    const result = await repository.create({
      tenantId: "tenant-a",
      provider: "META_WHATSAPP",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({ status: "created" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.whatsappIntegration.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        tenantId: "tenant-a",
        provider: "META_WHATSAPP",
        phoneNumberId: "phone-1",
      },
    });
  });

  it("maps P2002 unique constraint violation to duplicate", async () => {
    const tx = makeTx({
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
    });
    const prisma = makePrisma(tx);
    const repository = createPrismaWhatsAppIntegrationProvisioningRepository(prisma);

    const result = await repository.create({
      tenantId: "tenant-a",
      provider: "META_WHATSAPP",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({ status: "duplicate" });
  });

  it("maps other prisma errors to persistence_failure", async () => {
    const tx = makeTx({
      create: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const prisma = makePrisma(tx);
    const repository = createPrismaWhatsAppIntegrationProvisioningRepository(prisma);

    const result = await repository.create({
      tenantId: "tenant-a",
      provider: "META_WHATSAPP",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({ status: "persistence_failure" });
  });

  it("does not insert when tenant context cannot be created", async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const repository = createPrismaWhatsAppIntegrationProvisioningRepository(prisma);

    const result = await repository.create({
      tenantId: "" as never,
      provider: "META_WHATSAPP",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({ status: "persistence_failure" });
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(tx.whatsappIntegration.create).not.toHaveBeenCalled();
  });
});
