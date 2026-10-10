import { describe, expect, it, vi } from "vitest";
import { createServiceManager } from "./service-management";
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
    repository: {
      create: vi.fn().mockResolvedValue("created"),
      update: vi.fn().mockResolvedValue("updated"),
      setActive: vi.fn().mockResolvedValue("updated"),
      list: vi.fn().mockResolvedValue([
        {
          id: "service-1",
          tenantId: "tenant-1",
          name: "Haircut",
          durationMinutes: 60,
          bufferMinutes: 15,
          active: true,
        },
      ]),
    },
  };
}

describe("service management", () => {
  it("creates a service with normalized domain values", async () => {
    const d = deps();
    const result = await createServiceManager(d).create({
      identity,
      tenantContext,
      name: "  Haircut  ",
      durationMinutes: 60,
      bufferMinutes: 15,
    });

    expect(result.status).toBe("created");
    expect(d.repository.create).toHaveBeenCalledWith(tenantContext, {
      name: "Haircut",
      durationMinutes: 60,
      bufferMinutes: 15,
    });
  });

  it("rejects invalid input before persistence", async () => {
    const d = deps();
    const result = await createServiceManager(d).create({
      identity,
      tenantContext,
      name: "Haircut",
      durationMinutes: 0,
    });

    expect(result.status).toBe("INVALID_INPUT");
    expect(d.repository.create).not.toHaveBeenCalled();
  });

  it("fails closed for unauthorized management", async () => {
    const d = deps();
    d.authorizer.authorize.mockResolvedValue(false);

    const result = await createServiceManager(d).create({
      identity,
      tenantContext,
      name: "Haircut",
      durationMinutes: 60,
    });

    expect(result.status).toBe("UNAUTHORIZED");
    expect(d.repository.create).not.toHaveBeenCalled();
  });

  it("supports update and deactivate/reactivate", async () => {
    const d = deps();
    await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      name: "New Haircut",
      durationMinutes: 75,
    });
    await createServiceManager(d).setActive(identity, tenantContext, "service-1", false);
    await createServiceManager(d).setActive(identity, tenantContext, "service-1", true);

    expect(d.repository.update).toHaveBeenCalledWith(tenantContext, "service-1", {
      name: "New Haircut",
      durationMinutes: 75,
    });
    expect(d.repository.setActive).toHaveBeenNthCalledWith(2, tenantContext, "service-1", true);
  });

  it("lists through the tenant-aware repository", async () => {
    const d = deps();
    const result = await createServiceManager(d).list(identity, tenantContext);

    expect(result).toMatchObject({ status: "listed" });
    expect(d.repository.list).toHaveBeenCalledWith(tenantContext);
  });

  it("maps persistence failure without reporting success", async () => {
    const d = deps();
    d.repository.create.mockRejectedValue(new Error("db down"));

    const result = await createServiceManager(d).create({
      identity,
      tenantContext,
      name: "Haircut",
      durationMinutes: 60,
    });

    expect(result.status).toBe("PERSISTENCE_FAILURE");
  });

  it("fails closed when unauthorized to update a service", async () => {
    const d = deps();
    d.authorizer.authorize.mockResolvedValue(false);

    const result = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      name: "Updated Name",
    });

    expect(result.status).toBe("UNAUTHORIZED");
    expect(d.repository.update).not.toHaveBeenCalled();
  });

  it("rejects update with invalid duration or buffer", async () => {
    const d = deps();

    const invalidDuration = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      durationMinutes: 0,
    });
    expect(invalidDuration.status).toBe("INVALID_INPUT");

    const invalidBuffer = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      bufferMinutes: -5,
    });
    expect(invalidBuffer.status).toBe("INVALID_INPUT");

    const emptyName = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      name: "   ",
    });
    expect(emptyName.status).toBe("INVALID_INPUT");

    const emptyServiceId = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "   ",
      name: "Valid Name",
    });
    expect(emptyServiceId.status).toBe("INVALID_INPUT");

    const emptyPatch = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
    });
    expect(emptyPatch.status).toBe("INVALID_INPUT");

    expect(d.repository.update).not.toHaveBeenCalled();
  });

  it("returns not found when updating a service that does not exist", async () => {
    const d = deps();
    d.repository.update.mockResolvedValue("not_found");

    const result = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-missing",
      name: "Updated Name",
    });

    expect(result.status).toBe("NOT_FOUND");
    expect(d.repository.update).toHaveBeenCalledWith(
      tenantContext,
      "service-missing",
      { name: "Updated Name" },
    );
  });

  it("returns conflict when service update conflicts with existing name", async () => {
    const d = deps();
    d.repository.update.mockResolvedValue("conflict");

    const result = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      name: "Duplicate Name",
    });

    expect(result.status).toBe("CONFLICT");
  });

  it("maps update persistence failure to PERSISTENCE_FAILURE", async () => {
    const d = deps();
    d.repository.update.mockRejectedValue(new Error("db down"));

    const result = await createServiceManager(d).update({
      identity,
      tenantContext,
      serviceId: "service-1",
      name: "New Name",
    });

    expect(result.status).toBe("PERSISTENCE_FAILURE");
  });
});
