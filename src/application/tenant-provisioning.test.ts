import { describe, expect, it, vi } from "vitest";
import { createAuthSubjectId } from "../domain/auth-identity";
import type { AuthAdminProvisioner, AuthProvisioningResult } from "./auth-admin-provisioning";
import type { TenantAdminAuthBinding, TenantAdminAuthBindingResult } from "./tenant-admin-auth-binding";
import type {
  TenantProvisioningRepository,
  TenantProvisioningRepositoryResult,
} from "./tenant-provisioning";
import { createTenantProvisioner } from "./tenant-provisioning";

const actor = { kind: "SUPER_ADMIN" as const, subjectId: "super-admin-subject" };

function authProvisioner(): AuthAdminProvisioner & {
  provision: ReturnType<typeof vi.fn<() => Promise<AuthProvisioningResult>>>;
  compensate: ReturnType<typeof vi.fn<() => Promise<{ status: "compensated" | "failed" }>>>;
} {
  return {
    provision: vi.fn<() => Promise<AuthProvisioningResult>>(async () => ({
      status: "created",
      subjectId: createAuthSubjectId("owner-subject"),
    })),
    compensate: vi.fn<() => Promise<{ status: "compensated" | "failed" }>>(async () => ({
      status: "compensated",
    })),
  };
}

function authBinding(): TenantAdminAuthBinding & {
  bindTenant: ReturnType<typeof vi.fn<() => Promise<TenantAdminAuthBindingResult>>>;
} {
  return {
    bindTenant: vi.fn<() => Promise<TenantAdminAuthBindingResult>>(async () => ({
      status: "bound",
    })),
    rollbackTenantBinding: vi.fn(async () => ({ status: "rolled_back" as const })),
  };
}

function input() {
  return {
    actor,
    tenant: { name: "Güzellik & Bakım", timezone: "Europe/Istanbul" },
    firstAdmin: {
      displayName: "Salon Sahibi",
      email: "owner@example.com",
      password: "OwnerPass123!",
    },
  };
}

function makeProvisioner() {
  const repository: TenantProvisioningRepository = {
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
    }),
  };
}

describe("tenant provisioning application service", () => {
  it("fails closed when the actor is not authorized", async () => {
    const { repository } = makeProvisioner();
    const unauthorized = createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: false })) },
      repository,
      authProvisioner: authProvisioner(),
      authBinding: authBinding(),
    });

    await expect(unauthorized.provision(input())).resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(repository.provision).not.toHaveBeenCalled();
  });

  it("normalizes input and creates the first admin auth account before persistence", async () => {
    const { repository, auth, binding } = makeProvisioner();
    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository,
      authProvisioner: auth,
      authBinding: binding,
    }).provision(input());

    expect(result.status).toBe("created");
    expect(auth.provision).toHaveBeenCalledWith(expect.objectContaining({
      email: "owner@example.com",
      password: "OwnerPass123!",
      displayName: "Salon Sahibi",
      tenantId: expect.any(String),
    }));
    expect(binding.bindTenant).toHaveBeenCalledWith("owner-subject", expect.any(String));
    expect(repository.provision).toHaveBeenCalledWith(expect.objectContaining({
      tenant: expect.objectContaining({
        name: "Güzellik & Bakım",
        slug: "guzellik-bakim",
        timezone: "Europe/Istanbul",
      }),
    }));
  });

  it("rejects missing or malformed admin email before creating an auth account", async () => {
    const { auth } = makeProvisioner();
    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: { provision: vi.fn() },
      authProvisioner: auth,
      authBinding: authBinding(),
    }).provision({
      ...input(),
      firstAdmin: { ...input().firstAdmin, email: "" },
    });

    expect(result).toEqual({ status: "INVALID_INPUT" });
    expect(auth.provision).not.toHaveBeenCalled();
  });

  it("maps auth provisioning failure", async () => {
    const auth = authProvisioner();
    auth.provision.mockResolvedValueOnce({ status: "failed", reason: "ALREADY_EXISTS" });
    const repository: TenantProvisioningRepository = { provision: vi.fn() };

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
    binding.bindTenant.mockResolvedValueOnce({ status: "failed", reason: "PROVIDER_REJECTED" });

    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: { provision: vi.fn() },
      authProvisioner: auth,
      authBinding: binding,
    }).provision(input());

    expect(result).toEqual({ status: "AUTH_BINDING_FAILED" });
    expect(auth.compensate).toHaveBeenCalledWith(createAuthSubjectId("owner-subject"));
  });

  it("maps duplicate slug and compensates the provisioned admin", async () => {
    const { auth } = makeProvisioner();
    const duplicateRepository: TenantProvisioningRepository = {
      provision: vi.fn(async (): Promise<TenantProvisioningRepositoryResult> => ({
        status: "duplicate_slug",
      })),
    };

    const result = await createTenantProvisioner({
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      repository: duplicateRepository,
      authProvisioner: auth,
      authBinding: authBinding(),
    }).provision(input());

    expect(result).toEqual({ status: "DUPLICATE_SLUG" });
    expect(auth.compensate).toHaveBeenCalledWith(createAuthSubjectId("owner-subject"));
  });

  it("compensates the auth account on persistence failure", async () => {
    const auth = authProvisioner();
    const binding = authBinding();
    const repository: TenantProvisioningRepository = {
      provision: vi.fn(async (): Promise<TenantProvisioningRepositoryResult> => {
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
      createAuthSubjectId("owner-subject"),
      expect.any(String),
    );
    expect(auth.compensate).toHaveBeenCalledWith(createAuthSubjectId("owner-subject"));
  });
});
