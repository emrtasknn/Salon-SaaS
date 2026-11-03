import { describe, expect, it, vi } from "vitest";
import {
  PENDING_LIMIT,
  RECENT_LIMIT,
  RECENT_WINDOW_DAYS,
  createInAppNotifications,
  toInAppNotificationView,
  type InAppNotificationItem,
  type InAppNotificationRepository,
  type InAppNotificationSnapshot,
} from "./in-app-notifications";
import { createAuthenticatedIdentity, createUnauthenticatedIdentity } from "../domain/auth-identity";

const identity = createAuthenticatedIdentity("user-a", "profile-a");
const tenant = { tenantId: "tenant-a" as never };
const fixedNow = new Date("2026-11-04T12:00:00.000Z");
const expectedSince = new Date("2026-10-28T12:00:00.000Z");

const pendingItem: InAppNotificationItem = {
  appointmentId: "appointment-pending",
  kind: "PENDING_REQUEST",
  status: "PENDING",
  startAt: new Date("2026-11-05T09:00:00.000Z"),
  updatedAt: new Date("2026-11-04T10:00:00.000Z"),
  serviceName: "Saç kesimi",
  staffDisplayName: "Merve",
  customerDisplayName: "Ada",
};
const recentItem: InAppNotificationItem = {
  appointmentId: "appointment-recent",
  kind: "STATUS_CHANGED",
  status: "CONFIRMED",
  startAt: new Date("2026-11-06T09:00:00.000Z"),
  updatedAt: new Date("2026-11-03T08:30:00.000Z"),
  serviceName: "Sakal",
  staffDisplayName: "Merve",
  customerDisplayName: "Ada",
};
const snapshot: InAppNotificationSnapshot = { pendingCount: 42, pending: [pendingItem], recent: [recentItem] };

function setup(overrides: { admin?: boolean; staff?: boolean; read?: () => Promise<InAppNotificationSnapshot> } = {}) {
  const repository = { read: vi.fn(overrides.read ?? (async () => snapshot)) };
  const authorizer = {
    authorizeAdmin: vi.fn().mockResolvedValue(overrides.admin ?? true),
    authorizeStaffScope: vi.fn().mockResolvedValue(overrides.staff ?? true),
  };
  const service = createInAppNotifications({ repository, authorizer, now: () => fixedNow });
  return { repository, authorizer, service };
}

describe("in-app notifications service", () => {
  it("exposes the planned window and limits", () => {
    expect(RECENT_WINDOW_DAYS).toBe(7);
    expect(PENDING_LIMIT).toBe(20);
    expect(RECENT_LIMIT).toBe(20);
  });

  describe("forAdmin", () => {
    it("returns UNAUTHORIZED without touching the repository when the authorizer denies", async () => {
      const { repository, authorizer, service } = setup({ admin: false });
      await expect(service.forAdmin(identity, tenant)).resolves.toEqual({ status: "UNAUTHORIZED" });
      expect(authorizer.authorizeAdmin).toHaveBeenCalledWith(identity, tenant);
      expect(repository.read).not.toHaveBeenCalled();
    });

    it("returns UNAUTHORIZED for an unauthenticated identity without touching the repository", async () => {
      const { repository, service } = setup({ admin: false });
      const anonymous = createUnauthenticatedIdentity();
      await expect(service.forAdmin(anonymous, tenant)).resolves.toEqual({ status: "UNAUTHORIZED" });
      expect(repository.read).not.toHaveBeenCalled();
    });

    it("reads the whole tenant with since = now − 7 days and 20/20 limits", async () => {
      const { repository, service } = setup();
      const result = await service.forAdmin(identity, tenant);
      expect(repository.read).toHaveBeenCalledTimes(1);
      expect(repository.read).toHaveBeenCalledWith(tenant, { kind: "tenant" }, {
        since: expectedSince,
        pendingLimit: 20,
        recentLimit: 20,
      });
      expect(result).toEqual({ status: "ok", pendingCount: 42, pending: [pendingItem], recent: [recentItem] });
    });

    it("keeps customerDisplayName for admin results", async () => {
      const { service } = setup();
      const result = await service.forAdmin(identity, tenant);
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.pending[0].customerDisplayName).toBe("Ada");
      expect(result.recent[0].customerDisplayName).toBe("Ada");
    });

    it("maps repository failures to PERSISTENCE_FAILURE", async () => {
      const { service } = setup({ read: async () => { throw new Error("db down"); } });
      await expect(service.forAdmin(identity, tenant)).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
    });
  });

  describe("forStaff", () => {
    it("returns UNAUTHORIZED without touching the repository when the authorizer denies", async () => {
      const { repository, authorizer, service } = setup({ staff: false });
      await expect(service.forStaff(identity, tenant, "staff-other")).resolves.toEqual({ status: "UNAUTHORIZED" });
      expect(authorizer.authorizeStaffScope).toHaveBeenCalledWith(identity, tenant, "staff-other");
      expect(repository.read).not.toHaveBeenCalled();
    });

    it("returns UNAUTHORIZED for an unauthenticated identity without touching the repository", async () => {
      const { repository, service } = setup({ staff: false });
      await expect(service.forStaff(createUnauthenticatedIdentity(), tenant, "staff-a")).resolves.toEqual({ status: "UNAUTHORIZED" });
      expect(repository.read).not.toHaveBeenCalled();
    });

    it("does not fall back to admin authorization", async () => {
      const { authorizer, repository, service } = setup({ admin: true, staff: false });
      await service.forStaff(identity, tenant, "staff-a");
      expect(authorizer.authorizeAdmin).not.toHaveBeenCalled();
      expect(repository.read).not.toHaveBeenCalled();
    });

    it.each(["", "   ", "x".repeat(101), "staff\u0000a", "staff\na"])(
      "returns INVALID_INPUT for invalid staffId %j without touching the repository",
      async (staffId) => {
        const { repository, service } = setup();
        await expect(service.forStaff(identity, tenant, staffId)).resolves.toEqual({ status: "INVALID_INPUT" });
        expect(repository.read).not.toHaveBeenCalled();
      },
    );

    it("reads staff scope with the given staffId, since = now − 7 days and 20/20 limits", async () => {
      const { repository, service } = setup();
      const result = await service.forStaff(identity, tenant, "staff-a");
      expect(repository.read).toHaveBeenCalledTimes(1);
      expect(repository.read).toHaveBeenCalledWith(tenant, { kind: "staff", staffId: "staff-a" }, {
        since: expectedSince,
        pendingLimit: 20,
        recentLimit: 20,
      });
      expect(result.status).toBe("ok");
    });

    it("drops customerDisplayName from every staff item and keeps the true pendingCount", async () => {
      const { service } = setup();
      const result = await service.forStaff(identity, tenant, "staff-a");
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.pendingCount).toBe(42);
      for (const item of [...result.pending, ...result.recent]) {
        expect(item).not.toHaveProperty("customerDisplayName");
      }
      expect(result.pending[0]).toEqual({
        appointmentId: "appointment-pending",
        kind: "PENDING_REQUEST",
        status: "PENDING",
        startAt: pendingItem.startAt,
        updatedAt: pendingItem.updatedAt,
        serviceName: "Saç kesimi",
        staffDisplayName: "Merve",
      });
    });

    it("maps repository failures to PERSISTENCE_FAILURE", async () => {
      const { service } = setup({ read: async () => { throw new Error("db down"); } });
      await expect(service.forStaff(identity, tenant, "staff-a")).resolves.toEqual({ status: "PERSISTENCE_FAILURE" });
    });
  });

  it("uses the injected clock on every call", async () => {
    const repository = { read: vi.fn<InAppNotificationRepository["read"]>(async () => snapshot) };
    const authorizer = { authorizeAdmin: vi.fn().mockResolvedValue(true), authorizeStaffScope: vi.fn() };
    const times = [new Date("2026-11-04T00:00:00.000Z"), new Date("2026-11-10T00:00:00.000Z")];
    const now = vi.fn(() => times.shift() as Date);
    const service = createInAppNotifications({ repository, authorizer, now });
    await service.forAdmin(identity, tenant);
    await service.forAdmin(identity, tenant);
    expect(repository.read.mock.calls[0]?.[2].since).toEqual(new Date("2026-10-28T00:00:00.000Z"));
    expect(repository.read.mock.calls[1]?.[2].since).toEqual(new Date("2026-11-03T00:00:00.000Z"));
  });
});

describe("toInAppNotificationView", () => {
  it("serializes dates as ISO strings and keeps customer name only when present", () => {
    const { customerDisplayName: _omit, ...staffRecent } = recentItem;
    void _omit;
    const view = toInAppNotificationView({ status: "ok", pendingCount: 3, pending: [pendingItem], recent: [staffRecent] });
    expect(view).toEqual({
      status: "ok",
      pendingCount: 3,
      pending: [{
        appointmentId: "appointment-pending",
        kind: "PENDING_REQUEST",
        status: "PENDING",
        startAt: "2026-11-05T09:00:00.000Z",
        updatedAt: "2026-11-04T10:00:00.000Z",
        serviceName: "Saç kesimi",
        staffDisplayName: "Merve",
        customerDisplayName: "Ada",
      }],
      recent: [{
        appointmentId: "appointment-recent",
        kind: "STATUS_CHANGED",
        status: "CONFIRMED",
        startAt: "2026-11-06T09:00:00.000Z",
        updatedAt: "2026-11-03T08:30:00.000Z",
        serviceName: "Sakal",
        staffDisplayName: "Merve",
      }],
    });
    if (view.status !== "ok") throw new Error("expected ok");
    expect(view.recent[0]).not.toHaveProperty("customerDisplayName");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it.each(["UNAUTHORIZED", "INVALID_INPUT", "PERSISTENCE_FAILURE"] as const)("passes through %s with no data", (status) => {
    expect(toInAppNotificationView({ status })).toEqual({ status });
  });
});
