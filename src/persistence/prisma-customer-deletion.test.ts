import { describe, expect, it, vi } from "vitest";
import { DELETED_CUSTOMER_NAME } from "../domain/deletion";
import { createPrismaCustomerDeletionRepository } from "./prisma-customer-deletion";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const tenant = { tenantId: "t" as never };
const now = new Date("2026-11-16T12:00:00.000Z");
const input = { profileId: "c1", now };

function makeTx(o: { profile?: unknown; staff?: unknown; memberships?: number; count?: number; noteCount?: number } = {}) {
  const calls: string[] = [];
  const track = <T,>(name: string, value: T) => vi.fn().mockImplementation(async () => { calls.push(name); return value; });
  return {
    calls,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockImplementation(async () => { calls.push("lock"); return [{ id: "t" }]; }),
    profile: {
      findFirst: track("profile.find", o.profile === undefined ? { id: "c1" } : o.profile),
      update: track("profile.update", {}),
    },
    staff: { findFirst: track("staff.find", o.staff ?? null) },
    tenantMembership: { count: track("membership.count", o.memberships ?? 0) },
    appointment: { count: track("appointment.count", o.count ?? 0) },
    customerNote: { deleteMany: track("note.deleteMany", { count: o.noteCount ?? 1 }) },
    appointmentContact: { updateMany: track("contact.updateMany", { count: 1 }) },
  };
}

function repoFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return createPrismaCustomerDeletionRepository(prisma);
}

const WRITES = ["profile.update", "note.deleteMany", "contact.updateMany"];

describe("prisma customer erasure", () => {
  it("locks tenant, reads, counts, then writes in order", async () => {
    const tx = makeTx();
    await expect(repoFor(tx).erase(tenant, input)).resolves.toBe("erased");
    expect(tx.calls).toEqual(["lock", "profile.find", "staff.find", "membership.count", "appointment.count", ...WRITES]);
  });

  it("loads only non-erased profiles and counts only future active, non-archived appointments", async () => {
    const tx = makeTx();
    await repoFor(tx).erase(tenant, input);
    expect(tx.profile.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", id: "c1", deletedAt: null });
    expect(tx.appointment.count).toHaveBeenCalledWith({
      where: { tenantId: "t", customerProfileId: "c1", status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gt: now }, deletedAt: null },
    });
  });

  it("anonymizes the profile, deletes notes and clears contact PII on all of the customer's appointments", async () => {
    const tx = makeTx();
    await repoFor(tx).erase(tenant, input);
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "t", id: "c1" } },
      data: { deletedAt: now, displayName: DELETED_CUSTOMER_NAME, email: null, phone: null },
    });
    expect(tx.customerNote.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", customerProfileId: "c1" } });
    expect(tx.appointmentContact.updateMany).toHaveBeenCalledTimes(1);
    const args = tx.appointmentContact.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: "t", appointment: { tenantId: "t", customerProfileId: "c1" } });
    expect(args.data).toEqual({ displayName: DELETED_CUSTOMER_NAME, email: null, phone: null });
    expect(Object.keys(args.data).sort()).toEqual(["displayName", "email", "phone"]);
    expect(args.where.appointment).not.toHaveProperty("deletedAt");
  });

  it.each([
    ["not_found", { profile: null }, "not_found"],
    ["not_customer (staff row)", { staff: { id: "s1" } }, "not_customer"],
    ["not_customer (membership)", { memberships: 1 }, "not_customer"],
    ["has_active_appointments", { count: 2 }, { status: "has_active_appointments", count: 2 }],
  ] as const)("performs no write when %s", async (_name, setup, expected) => {
    const tx = makeTx(setup as never);
    await expect(repoFor(tx).erase(tenant, input)).resolves.toEqual(expected);
    expect(tx.calls.filter((c) => WRITES.includes(c))).toEqual([]);
  });

  it("checks staff and memberships scoped by tenant", async () => {
    const tx = makeTx();
    await repoFor(tx).erase(tenant, input);
    expect(tx.staff.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t", profileId: "c1" });
    expect(tx.tenantMembership.count).toHaveBeenCalledWith({ where: { tenantId: "t", profileId: "c1" } });
  });
});

describe("prisma customer note delete", () => {
  function noteRepo(count: number) {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), customerNote: { deleteMany: vi.fn().mockResolvedValue({ count }) } };
    const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
    return { tx, repo: createPrismaCustomerDeletionRepository(prisma) };
  }

  it("deletes by tenantId and id", async () => {
    const { tx, repo } = noteRepo(1);
    await expect(repo.deleteNote(tenant, "n1")).resolves.toBe("deleted");
    expect(tx.customerNote.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", id: "n1" } });
  });

  it("returns not_found when nothing matched", async () => {
    await expect(noteRepo(0).repo.deleteNote(tenant, "n1")).resolves.toBe("not_found");
  });
});
