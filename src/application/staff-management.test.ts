import { describe, expect, it, vi } from "vitest";
import { createAdminServesAsStaff, createStaffManager } from "./staff-management";
import type { TenantContext } from "../domain/tenant-context";
import type { ApplicationIdentity } from "../domain/auth-identity";

const tenantContext = { tenantId: "tenant-1" } as TenantContext;
const identity: ApplicationIdentity = {
  state: "authenticated",
  subjectId: "subject-1" as never,
  profileId: "profile-1",
};

function deps() {
  return {
    authorizer: { authorize: vi.fn().mockResolvedValue(true) },
    authProvisioner: {
      provision: vi.fn().mockResolvedValue({
        status: "created",
        subjectId: "subject-2",
      }),
      compensate: vi.fn().mockResolvedValue({ status: "compensated" }),
    },
    authBinding: {
      bindTenant: vi.fn().mockResolvedValue({ status: "bound" }),
      rollbackTenantBinding: vi.fn().mockResolvedValue({ status: "rolled_back" }),
    },
    repository: {
      create: vi.fn().mockResolvedValue({
        status: "created",
        staff: {
          id: "staff-1",
          tenantId: "tenant-1",
          profileId: "profile-2",
          status: "ACTIVE",
        },
      }),
      updateProfile: vi.fn().mockResolvedValue("updated"),
      setStatus: vi.fn().mockResolvedValue("updated"),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("staff management", () => {
  it("uses provider-derived subject and compensates persistence conflict", async () => {
    const d = deps();
    d.repository.create.mockResolvedValue({ status: "conflict" });

    const result = await createStaffManager(d).create({
      identity,
      tenantContext,
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result.status).toBe("CONFLICT");
    expect(d.authProvisioner.provision).toHaveBeenCalledWith({
      email: "ada@example.com",
      displayName: "Ada",
      tenantId: "tenant-1",
    });
    expect(d.authBinding.bindTenant).toHaveBeenCalledWith("subject-2", "tenant-1");
    expect(d.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: "subject-2" }),
    );
    expect(d.authBinding.rollbackTenantBinding).toHaveBeenCalledWith("subject-2", "tenant-1");
    expect(d.authProvisioner.compensate).toHaveBeenCalledWith("subject-2");
  });

  it("passes an admin-set temporary password to auth provisioning (no invite email)", async () => {
    const d = deps();
    d.repository.create.mockResolvedValue({ status: "created", staff: { id: "s" } } as never);
    await createStaffManager(d).create({
      identity, tenantContext, displayName: "Ada", email: "ada@example.com", password: "gecici-123",
    });
    expect(d.authProvisioner.provision).toHaveBeenCalledWith({
      email: "ada@example.com", displayName: "Ada", tenantId: "tenant-1", password: "gecici-123",
    });
    // The password never reaches persistence.
    expect(JSON.stringify(d.repository.create.mock.calls)).not.toContain("gecici-123");
  });

  it.each([
    ["too short", { email: "ada@example.com", password: "short" }],
    ["too long", { email: "ada@example.com", password: "x".repeat(129) }],
    ["not a string", { email: "ada@example.com", password: 12345678 }],
    ["password without email", { password: "gecici-123" }],
  ])("rejects a temporary password that is %s before provisioning", async (_label, extra) => {
    const d = deps();
    const result = await createStaffManager(d).create({ identity, tenantContext, displayName: "Ada", ...extra });
    expect(result.status).toBe("INVALID_INPUT");
    expect(d.authProvisioner.provision).not.toHaveBeenCalled();
  });

  it("surfaces compensation failure explicitly", async () => {
    const d = deps();
    d.repository.create.mockResolvedValue({ status: "conflict" });
    d.authProvisioner.compensate.mockResolvedValue({ status: "failed" });

    const result = await createStaffManager(d).create({
      identity,
      tenantContext,
      displayName: "Ada",
    });

    expect(result.status).toBe("COMPENSATION_FAILED");
    expect(d.authProvisioner.compensate).toHaveBeenCalledWith("subject-2");
  });

  it("compensates the auth user and does not persist when tenant binding fails", async () => {
    const d = deps();
    d.authBinding.bindTenant.mockResolvedValue({
      status: "failed",
      reason: "PROVIDER_REJECTED",
    });

    const result = await createStaffManager(d).create({
      identity,
      tenantContext,
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result.status).toBe("AUTH_BINDING_FAILED");
    expect(d.repository.create).not.toHaveBeenCalled();
    expect(d.authProvisioner.compensate).toHaveBeenCalledWith("subject-2");
  });

  it("does not persist when auth provisioning fails", async () => {
    const d = deps();
    d.authProvisioner.provision.mockResolvedValue({
      status: "failed",
      reason: "PROVIDER_REJECTED",
    });

    const result = await createStaffManager(d).create({
      identity,
      tenantContext,
      displayName: "Ada",
    });

    expect(result.status).toBe("AUTH_PROVISIONING_FAILED");
    expect(d.repository.create).not.toHaveBeenCalled();
  });

  it("fails closed when unauthorized to create", async () => {
    const d = deps();
    d.authorizer.authorize.mockResolvedValue(false);

    const result = await createStaffManager(d).create({
      identity,
      tenantContext,
      displayName: "Ada",
    });

    expect(result.status).toBe("UNAUTHORIZED");
    expect(d.authProvisioner.provision).not.toHaveBeenCalled();
    expect(d.repository.create).not.toHaveBeenCalled();
  });

  it("supports deactivate and reactivation", async () => {
    const d = deps();

    await createStaffManager(d).setStatus(
      identity,
      tenantContext,
      "staff-1",
      "INACTIVE",
    );
    await createStaffManager(d).setStatus(
      identity,
      tenantContext,
      "staff-1",
      "ACTIVE",
    );

    expect(d.repository.setStatus).toHaveBeenNthCalledWith(
      2,
      tenantContext,
      "staff-1",
      "ACTIVE",
    );
  });

  it("updates a staff profile with normalized display name and phone", async () => {
    const d = deps();

    const result = await createStaffManager(d).updateProfile(
      identity,
      tenantContext,
      "staff-1",
      { displayName: "  Ada Lovelace  ", phone: "  +90 555 123 45 67  " },
    );

    expect(result).toEqual({ status: "updated" });
    expect(d.authorizer.authorize).toHaveBeenCalledWith(
      identity,
      tenantContext,
      "TENANT_ADMIN",
    );
    expect(d.repository.updateProfile).toHaveBeenCalledWith(
      tenantContext,
      "staff-1",
      { displayName: "Ada Lovelace", phone: "+90 555 123 45 67" },
    );
  });

  it("does not update a staff profile when unauthorized", async () => {
    const d = deps();
    d.authorizer.authorize.mockResolvedValue(false);

    const result = await createStaffManager(d).updateProfile(
      identity,
      tenantContext,
      "staff-1",
      { displayName: "Ada Lovelace", phone: "5551234567" },
    );

    expect(result).toEqual({ status: "UNAUTHORIZED" });
    expect(d.repository.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects an empty display name without persisting", async () => {
    const d = deps();

    const result = await createStaffManager(d).updateProfile(
      identity,
      tenantContext,
      "staff-1",
      { displayName: "   " },
    );

    expect(result).toEqual({ status: "INVALID_INPUT" });
    expect(d.repository.updateProfile).not.toHaveBeenCalled();
  });

  it("returns not found when the staff profile does not exist", async () => {
    const d = deps();
    d.repository.updateProfile.mockResolvedValue("not_found");

    const result = await createStaffManager(d).updateProfile(
      identity,
      tenantContext,
      "staff-missing",
      { displayName: "Ada Lovelace" },
    );

    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("returns conflict when the profile update conflicts", async () => {
    const d = deps();
    d.repository.updateProfile.mockResolvedValue("conflict");

    const result = await createStaffManager(d).updateProfile(
      identity,
      tenantContext,
      "staff-1",
      { displayName: "Ada Lovelace" },
    );

    expect(result).toEqual({ status: "CONFLICT" });
  });
});

describe("admin serves as staff (owner decision 2026-11-05)", () => {
  function selfDeps(membership: { role: string; profileId: string } | null = { role: "TENANT_ADMIN", profileId: "profile-1" }) {
    return {
      membershipReader: { readOwnMembership: vi.fn().mockResolvedValue(membership) },
      repository: {
        findOwnStatus: vi.fn().mockResolvedValue(null),
        setOwnStatus: vi.fn().mockResolvedValue("updated"),
      },
    };
  }

  it("enables serving for the caller's own membership profile only", async () => {
    const dependencies = selfDeps();
    const result = await createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, true);
    expect(result).toEqual({ status: "ok", servesAsStaff: true });
    expect(dependencies.membershipReader.readOwnMembership).toHaveBeenCalledWith(identity, tenantContext);
    expect(dependencies.repository.setOwnStatus).toHaveBeenCalledExactlyOnceWith(tenantContext, "profile-1", "ACTIVE");
  });

  it("disables by setting the own row INACTIVE (never deletes)", async () => {
    const dependencies = selfDeps();
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, false))
      .resolves.toEqual({ status: "ok", servesAsStaff: false });
    expect(dependencies.repository.setOwnStatus).toHaveBeenCalledExactlyOnceWith(tenantContext, "profile-1", "INACTIVE");
  });

  it("cannot target another profile: a membership profile that differs from the session profile is refused", async () => {
    const dependencies = selfDeps({ role: "TENANT_ADMIN", profileId: "someone-else" });
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, true))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(dependencies.repository.setOwnStatus).not.toHaveBeenCalled();
  });

  it("takes no profile or staff id: extra arguments cannot redirect the write", async () => {
    const dependencies = selfDeps();
    const set = createAdminServesAsStaff(dependencies as never).set as (...args: unknown[]) => Promise<unknown>;
    await set(identity, tenantContext, true, "other-profile", "other-staff");
    expect(dependencies.repository.setOwnStatus).toHaveBeenCalledExactlyOnceWith(tenantContext, "profile-1", "ACTIVE");
  });

  it.each(["STAFF", "SUPER_ADMIN", "CUSTOMER"])("refuses a %s membership", async (role) => {
    const dependencies = selfDeps({ role, profileId: "profile-1" });
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, true))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    await expect(createAdminServesAsStaff(dependencies as never).read(identity, tenantContext))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(dependencies.repository.setOwnStatus).not.toHaveBeenCalled();
    expect(dependencies.repository.findOwnStatus).not.toHaveBeenCalled();
  });

  it("refuses without a membership or an authenticated identity", async () => {
    const dependencies = selfDeps(null);
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, true))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    const anonymous = { state: "unauthenticated" } as ApplicationIdentity;
    await expect(createAdminServesAsStaff(selfDeps() as never).set(anonymous, tenantContext, true))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    expect(dependencies.repository.setOwnStatus).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean flag before any read", async () => {
    const dependencies = selfDeps();
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, "true"))
      .resolves.toEqual({ status: "INVALID_INPUT" });
    expect(dependencies.membershipReader.readOwnMembership).not.toHaveBeenCalled();
  });

  it("reads the flag from the own row status", async () => {
    for (const [status, expected] of [[null, false], ["INACTIVE", false], ["ACTIVE", true]] as const) {
      const dependencies = selfDeps();
      dependencies.repository.findOwnStatus.mockResolvedValue(status);
      await expect(createAdminServesAsStaff(dependencies as never).read(identity, tenantContext))
        .resolves.toEqual({ status: "ok", servesAsStaff: expected });
      expect(dependencies.repository.findOwnStatus).toHaveBeenCalledWith(tenantContext, "profile-1");
    }
  });

  it("maps persistence errors to PERSISTENCE_FAILURE", async () => {
    const dependencies = selfDeps();
    dependencies.repository.setOwnStatus.mockRejectedValue(new Error("db down"));
    await expect(createAdminServesAsStaff(dependencies as never).set(identity, tenantContext, true))
      .resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
