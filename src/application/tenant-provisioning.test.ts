import { describe, expect, it, vi } from "vitest";
import { createTenantProvisioner } from "./tenant-provisioning";

const actor = { kind: "SUPER_ADMIN" as const, subjectId: "admin-subject" };

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
    });

    await expect(failingProvisioner.provision(input())).resolves.toEqual({
      status: "PERSISTENCE_FAILURE",
    });
  });
});