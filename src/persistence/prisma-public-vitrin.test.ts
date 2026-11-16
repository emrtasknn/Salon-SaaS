import { describe, expect, it, vi } from "vitest";
import { createPrismaPublicSalonRepository } from "./prisma-public-vitrin";
import type { PrismaTenantClient } from "./prisma-tenant-context";

function prismaWith(findUnique: ReturnType<typeof vi.fn>) {
  const tx = { tenant: { findUnique } };
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return prisma;
}

describe("prisma public vitrin slug lookup", () => {
  it("filters archived tenants: the slug lookup carries deletedAt: null", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repository = createPrismaPublicSalonRepository(prismaWith(findUnique));
    await expect(repository.resolveBySlug("salon-x")).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: "salon-x", deletedAt: null } });
  });

  it("resolves a live tenant by slug", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "t1", name: "Salon X", timezone: "Europe/Istanbul", status: "ACTIVE", contactPhone: null,
      legalName: null, legalAddress: null, kvkkContactEmail: null, publicAddress: null, mapsUrl: null,
    });
    const repository = createPrismaPublicSalonRepository(prismaWith(findUnique));
    const result = await repository.resolveBySlug("salon-x");
    expect(result?.tenantContext).toEqual({ tenantId: "t1" });
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: "salon-x", deletedAt: null } });
  });
});
