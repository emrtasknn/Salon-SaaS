import { describe, expect, it, vi } from "vitest";
import { createPrismaStaffDeletionRepository } from "./prisma-staff-deletion";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const tenant = { tenantId: "t" as never };
const now = new Date("2026-11-16T12:00:00.000Z");
const input = { staffId: "s1", actorProfileId: "admin-p", now };

function makeTx(o: { staff?: unknown; memberships?: Array<{ role: string }>; count?: number } = {}) {
  const calls: string[] = [];
  const track = <T,>(name: string, value: T) => vi.fn().mockImplementation(async () => { calls.push(name); return value; });
  const tx = {
    calls,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockImplementation(async () => { calls.push("lock"); return [{ id: "t" }]; }),
    staff: {
      findFirst: track("staff.find", o.staff === undefined ? { id: "s1", profileId: "p1" } : o.staff),
      update: track("staff.update", {}),
    },
    tenantMembership: { findMany: track("membership.find", o.memberships ?? [{ role: "STAFF" }]), deleteMany: track("membership.delete", { count: 1 }) },
    appointment: { count: track("appointment.count", o.count ?? 0) },
    staffService: { deleteMany: track("staffService.delete", { count: 1 }) },
    pushSubscription: { updateMany: track("push.revoke", { count: 1 }) },
    profile: { update: track("profile.update", {}) },
  };
  return tx;
}

function repoFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return createPrismaStaffDeletionRepository(prisma);
}

const WRITES = ["staff.update", "staffService.delete", "membership.delete", "push.revoke", "profile.update"];

describe("prisma staff deletion", () => {
  it("locks tenant, reads, counts, then writes in order", async () => {
    const tx = makeTx();
    await expect(repoFor(tx).archive(tenant, input)).resolves.toBe("archived");
    expect(tx.calls).toEqual(["lock", "staff.find", "membership.find", "appointment.count", ...WRITES]);
  });

  it("counts only future PENDING/CONFIRMED non-archived appointments", async () => {
    const tx = makeTx();
    await repoFor(tx).archive(tenant, input);
    expect(tx.appointment.count).toHaveBeenCalledWith({
      where: { tenantId: "t", staffId: "s1", status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gt: now }, deletedAt: null },
    });
    expect(tx.staff.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", id: "s1", deletedAt: null });
  });

  it("issues all five writes scoped by tenantId", async () => {
    const tx = makeTx();
    await repoFor(tx).archive(tenant, input);
    expect(tx.staff.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "t", id: "s1" } }, data: { deletedAt: now, status: "INACTIVE" },
    });
    expect(tx.staffService.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", staffId: "s1" } });
    expect(tx.tenantMembership.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", profileId: "p1" } });
    expect(tx.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t", profileId: "p1", revokedAt: null }, data: { revokedAt: now },
    });
    expect(tx.profile.update).toHaveBeenCalledWith({ where: { tenantId_id: { tenantId: "t", id: "p1" } }, data: { email: null } });
  });

  it("still archives when the profile has no membership rows", async () => {
    const tx = makeTx({ memberships: [] });
    await expect(repoFor(tx).archive(tenant, input)).resolves.toBe("archived");
    expect(tx.calls).toEqual(["lock", "staff.find", "membership.find", "appointment.count", ...WRITES]);
    expect(tx.tenantMembership.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", profileId: "p1" } });
  });

  it.each([
    ["not_found", { staff: null }, "not_found"],
    ["is_self", { staff: { id: "s1", profileId: "admin-p" } }, "is_self"],
    ["not_staff_role", { memberships: [{ role: "STAFF" }, { role: "TENANT_ADMIN" }] }, "not_staff_role"],
    ["has_active_appointments", { count: 2 }, { status: "has_active_appointments", count: 2 }],
  ] as const)("performs no write when %s", async (_name, setup, expected) => {
    const tx = makeTx(setup as never);
    await expect(repoFor(tx).archive(tenant, input)).resolves.toEqual(expected);
    expect(tx.calls.filter((c) => WRITES.includes(c))).toEqual([]);
  });
});
