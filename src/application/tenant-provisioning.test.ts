import { describe, expect, it, vi } from "vitest";
import { createTenantProvisioner } from "./tenant-provisioning";

const actor = { kind: "SUPER_ADMIN" as const, subjectId: "super-admin-subject" };

function authProvisioner() {
  return {
    provision: vi.fn(async () => ({
      status: "created" as const,
      subjectId: "owner-subject" as const,
    })),
    compensate: vi.fn(async () => ({ status: "compensated" as const })),
  };
}

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
      displayName: "Salon Sahibi",
      email: "owner@example.com",
    },
  };
}

function provisioner(overrides: Record<string, unknown> = {}) {
  const repository = {
    provision: vi.fn(async (value) => ({
      status: "created" as const,
      tenantId: value.tenant.tenantId,
      profileId: "profile-1",
    })),
  };
  const auth = authProvisioner();
  const binding = authBinding();

  return {
    repository,
    auth,
    binding,
    provisioner: createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authProvisioner: auth,
      authBinding: binding,
      ...overrides,
    }),
  };
}

describe("tenant provisioning application service", () => {
  it("fails closed when the actor is not authorized", async () => {
    const { repository, provisioner } = provisioner();
    const unauthorized = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: false })) },
      repository,
      authProvisioner: authProvisioner(),
      authBinding: authBinding(),
    });

    await expect(unauthorized.provision(input())).resolves.toEqual({
      status: "UNAUTHORIZED",
    });
    expect(repository.provision).not.toHaveBeenCalled();
  });

  it("normalizes input and creates the first admin auth account before persistence", async () => {
    const { repository, auth, binding, provisioner } = provisioner();

    const result = await provisioner.provision(input());

    expect(result.status).toBe("created");
    expect(auth.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@example.com",
        displayName: "Salon Sahibi",
        tenantId: expect.any(String),
      }),
    );
    expect(binding.bindTenant).toHaveBeenCalledWith(
      "owner-subject",
      expect.any(String),
    );
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
          email: "owner@example.com",
        }),
      }),
    );
  });

  it("rejects missing or malformed admin email before creating an auth account", async () => {
    const { auth, provisioner } = provisioner();

    await expect(
      provisioner.provision({
        ...input(),
        firstAdmin: { ...input().firstAdmin, email: "" },
      }),
    ).resolves.toEqual({ status: "INVALID_INPUT" });

    expect(auth.provision).not.toHaveBeenCalled();
  });

  it("maps auth provisioning failure", async () => {
    const auth = authProvisioner();
    auth.provision.mockResolvedValueOnce({
      status: "failed" as const,
      reason: "ALREADY_EXISTS" as const,
    });

    const repository = { provision: vi.fn() };
    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authProvisioner: auth,
      authBinding: authBinding(),
    }).provision(input());

    expect(result).toEqual({ status: "AUTH_PROVISIONING_FAILED" });
    expect(repository.provision).not.toHaveBeenCalled();
  });

  it("compensates the auth account when tenant binding fails", async () => {
    const auth = authProvisioner();
    const binding = authBinding();
    binding.bindTenant.mockResolvedValueOnce({
      status: "failed" as const,
      reason: "PROVIDER_REJECTED" as const,
    });

    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: { provision: vi.fn() },
      authProvisioner: auth,
      authBinding: binding,
    }).provision(input());

    expect(result).toEqual({ status: "AUTH_BINDING_FAILED" });
    expect(auth.compensate).toHaveBeenCalledWith("owner-subject");
  });

  it("maps duplicate slug and compensates the invited admin", async () => {
    const { auth } = provisioner();
    const duplicateRepository = {
      provision: vi.fn(async () => ({ status: "duplicate_slug" as const })),
    };

    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: duplicateRepository,
      authProvisioner: auth,
      authBinding: authBinding(),
    }).provision(input());

    expect(result).toEqual({ status: "DUPLICATE_SLUG" });
    expect(auth.compensate).toHaveBeenCalledWith("owner-subject");
  });

  it("compensates the auth account on persistence failure", async () => {
    const auth = authProvisioner();
    const binding = authBinding();
    const repository = {
      provision: vi.fn(async () => {
        throw new Error("db down");
      }),
    };

    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authProvisioner: auth,
      authBinding: binding,
    }).provision(input());

    expect(result).toEqual({ status: "PERSISTENCE_FAILURE" });
    expect(binding.rollbackTenantBinding).toHaveBeenCalledWith(
      "owner-subject",
      expect.any(String),
    );
    expect(auth.compensate).toHaveBeenCalledWith("owner-subject");
  });
});
