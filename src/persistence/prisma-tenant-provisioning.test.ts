import { describe, expect, it, vi } from "vitest";
import { createPrismaTenantProvisioningRepository } from "./prisma-tenant-provisioning";

function input() {
  return {
    tenant: {
      tenantId: "tenant-1" as never,
      name: "Salon Ada",
      slug: "salon-ada",
      timezone: "Europe/Istanbul",
    },
    firstAdmin: {
      subjectId: "owner-subject",
      displayName: "Salon Sahibi",
      email: "owner@example.com",
      phone: null,
    },
  };
}

describe("Prisma tenant provisioning repository", () => {
  it("creates tenant, profile and membership in one transaction", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "tenant-1" })
      .mockResolvedValueOnce({ id: "profile-1" })
      .mockResolvedValueOnce({ id: "membership-1" });
    const executeRaw = vi.fn(async () => 1);

    const repository = createPrismaTenantProvisioningRepository({
      $transaction: vi.fn(async (operation) =>
        operation({
          $executeRaw: executeRaw,
          tenant: { create },
          profile: { create },
          tenantMembership: { create },
        }),
      ),
    });

    await expect(repository.provision(input())).resolves.toEqual({
      status: "created",
      tenantId: "tenant-1",
      profileId: "profile-1",
    });

    expect(create).toHaveBeenNthCalledWith(1, {
      data: {
        id: "tenant-1",
        slug: "salon-ada",
        name: "Salon Ada",
        timezone: "Europe/Istanbul",
      },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        tenantId: "tenant-1",
        displayName: "Salon Sahibi",
        email: "owner@example.com",
        phone: null,
      },
    });
    // Tenant context is bound after the Tenant insert and before the RLS-protected inserts.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledWith(expect.anything(), "tenant-1");
    expect(executeRaw.mock.invocationCallOrder[0]).toBeGreaterThan(create.mock.invocationCallOrder[0]);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[1]);
    expect(create).toHaveBeenNthCalledWith(3, {
      data: {
        tenantId: "tenant-1",
        subjectId: "owner-subject",
        profileId: "profile-1",
        role: "TENANT_ADMIN",
      },
    });
  });

  it("maps a unique slug conflict", async () => {
    const repository = createPrismaTenantProvisioningRepository({
      $transaction: vi.fn(async () => {
        const error = Object.assign(new Error("duplicate"), { code: "P2002" });
        throw error;
      }),
    });

    await expect(repository.provision(input())).resolves.toEqual({
      status: "duplicate_slug",
    });
  });
});