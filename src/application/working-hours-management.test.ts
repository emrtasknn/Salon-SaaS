import { describe, expect, it, vi } from "vitest";
import { createWorkingHoursManager } from "./working-hours-management";

const identity = { state: "authenticated", subjectId: "subject_1", profileId: "profile_1" } as const;
const tenantContext = { tenantId: "tenant_1" as never };

describe("working hours management", () => {
  it("creates a valid weekly interval", async () => {
    const repository = { upsert: vi.fn().mockResolvedValue("created"), remove: vi.fn(), list: vi.fn() };
    const manager = createWorkingHoursManager({
      authorizer: { authorize: vi.fn().mockResolvedValue(true) },
      repository,
    });
    await expect(manager.upsert(identity, tenantContext, { dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }))
      .resolves.toEqual({ status: "created" });
    expect(repository.upsert).toHaveBeenCalledWith(tenantContext, { dayOfWeek: 1, openMinute: 540, closeMinute: 1080 });
  });

  it("rejects invalid and unauthorized changes", async () => {
    const repository = { upsert: vi.fn(), remove: vi.fn(), list: vi.fn() };
    const manager = createWorkingHoursManager({
      authorizer: { authorize: vi.fn().mockResolvedValue(false) },
      repository,
    });
    await expect(manager.upsert(identity, tenantContext, { dayOfWeek: 7, openMinute: 1, closeMinute: 2 }))
      .resolves.toEqual({ status: "UNAUTHORIZED" });
    const authorized = createWorkingHoursManager({
      authorizer: { authorize: vi.fn().mockResolvedValue(true) },
      repository,
    });
    await expect(authorized.upsert(identity, tenantContext, { dayOfWeek: 1, openMinute: 100, closeMinute: 100 }))
      .resolves.toEqual({ status: "INVALID_INPUT" });
  });

  it("removes a closed day and lists tenant hours", async () => {
    const hours = [{ id: "wh_1", tenantId: "tenant_1", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }];
    const repository = { upsert: vi.fn(), remove: vi.fn().mockResolvedValue("removed"), list: vi.fn().mockResolvedValue(hours) };
    const manager = createWorkingHoursManager({
      authorizer: { authorize: vi.fn().mockResolvedValue(true) },
      repository,
    });
    await expect(manager.remove(identity, tenantContext, 1)).resolves.toEqual({ status: "removed" });
    await expect(manager.list(identity, tenantContext)).resolves.toEqual({ status: "listed", workingHours: hours });
  });
});
