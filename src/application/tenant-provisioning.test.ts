import { describe, expect, it, vi } from "vitest";
import { createTenantProvisioner } from "./tenant-provisioning";

const actor = { kind: "SUPER_ADMIN" as const, subjectId: "admin-subject" };

function authBinding() {
  return {
    bindTenant: vi.fn(async () => ({ status: "bound" as const })),
    rollbackTenantBinding: vi.fn(async () => ({ status: "rolled_back" as const })),
  };
}

function input() {
  return {
    actor,
    tenant: {
      name: "Güzellik & Bakım",
      timezone: "Europe/Istanbul",
    },
    firstAdmin: {
      subjectId: "owner-subject",
      displayName: "Salon Sahibi",
      email: "owner@example.com",
    },
  };
}

describe("tenant provisioning application service", () => {
  it("fails closed when the actor is not authorized", async () => {
    const repository = { provision: vi.fn() };
    const provisioner = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: false })) },
      repository,
      authBinding: authBinding(),
    });

    await expect(provisioner.provision(input())).resolves.toEqual({
      status: "UNAUTHORIZED",
    });
    expect(repository.provision).not.toHaveBeenCalled();
  });

  it("normalizes input before the repository boundary", async () => {
    const repository = {
      provision: vi.fn(async (value) => ({
        status: "created" as const,
        tenantId: value.tenant.tenantId,
        profileId: "profile-1",
      })),
    };
    const provisioner = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authBinding: authBinding(),
    });

    const result = await provisioner.provision(input());

    expect(result.status).toBe("created");
    expect(repository.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: expect.objectContaining({
          name: "Güzellik & Bakım",
          slug: "guzellik-bakim",
          timezone: "Europe/Istanbul",
        }),
        firstAdmin: expect.objectContaining({
          subjectId: "owner-subject",
          displayName: "Salon Sahibi",
        }),
      }),
    );
  });

  it("maps duplicate slug and persistence failures", async () => {
    const duplicateProvisioner = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: {
        provision: vi.fn(async () => ({ status: "duplicate_slug" as const })),
      },
      authBinding: authBinding(),
    });

    await expect(duplicateProvisioner.provision(input())).resolves.toEqual({
      status: "DUPLICATE_SLUG",
    });

    const failingProvisioner = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: {
        provision: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
      authBinding: authBinding(),
    });

    await expect(failingProvisioner.provision(input())).resolves.toEqual({
      status: "PERSISTENCE_FAILURE",
    });
  });

  it("binds the first admin before persistence and rolls it back on persistence failure", async () => {
    const binding = authBinding();
    const repository = {
      provision: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const provisioner = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authBinding: binding,
    });

    await expect(provisioner.provision(input())).resolves.toEqual({
      status: "PERSISTENCE_FAILURE",
    });
    expect(binding.bindTenant).toHaveBeenCalledWith(
      "owner-subject",
      expect.any(String),
    );
    expect(binding.rollbackTenantBinding).toHaveBeenCalledWith(
      "owner-subject",
      expect.any(String),
    );
  });
});