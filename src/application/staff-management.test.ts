import { describe, expect, it, vi } from "vitest";
import { createStaffManager } from "./staff-management";
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
    expect(d.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: "subject-2" }),
    );
    expect(d.authProvisioner.compensate).toHaveBeenCalledWith("subject-2");
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
