import { describe, expect, it, vi } from "vitest";
import { createPrismaAppointmentAccessTokenRepository } from "./prisma-appointment-access-token";
import type { PrismaTenantClient } from "./prisma-tenant-context";

const TENANT = { tenantId: "tenant-a" as never };
const HASH = "c".repeat(64);
const NOW = new Date("2026-11-05T06:00:00.000Z");
const START = new Date("2026-11-05T10:00:00.000Z");
const END = new Date("2026-11-05T10:45:00.000Z");

function makeTransaction(options: { token?: { appointmentId: string } | null; updateCount?: number } = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    tenantMembership: { findUnique: vi.fn() },
    appointmentAccessToken: { findFirst: vi.fn().mockResolvedValue(options.token === undefined ? { appointmentId: "appt-a" } : options.token) },
    appointment: {
      findUnique: vi.fn().mockResolvedValue({ id: "appt-a", status: "PENDING", startAt: START, endAt: END, serviceId: "svc-a", staffId: "staff-a" }),
      updateMany: vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 }),
    },
    service: { findUnique: vi.fn().mockResolvedValue({ name: "Saç Kesimi" }) },
    staff: { findUnique: vi.fn().mockResolvedValue({ profileId: "profile-a" }) },
    profile: { findUnique: vi.fn().mockResolvedValue({ displayName: "Ali" }) },
  };
}

function makePrisma(transaction: ReturnType<typeof makeTransaction>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(transaction as never));
  return prisma;
}

const tenantGucValue = (transaction: ReturnType<typeof makeTransaction>) =>
  transaction.$executeRaw.mock.calls.find((call) => String(call[0]).includes("app.tenant_id"))?.[1];

const usableTokenWhere = { tenantId: "tenant-a", tokenHash: HASH, revokedAt: null, expiresAt: { gt: NOW } };

describe("prisma appointment access token repository", () => {
  it("looks a token up by (tenantId, tokenHash, not revoked, not expired) under the tenant GUC", async () => {
    const transaction = makeTransaction();
    const details = await createPrismaAppointmentAccessTokenRepository(makePrisma(transaction)).findDetailsByTokenHash(TENANT, HASH, NOW);
    expect(tenantGucValue(transaction)).toBe("tenant-a");
    expect(transaction.appointmentAccessToken.findFirst).toHaveBeenCalledWith({ where: usableTokenWhere, select: { appointmentId: true } });
    expect(transaction.appointment.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_id: { tenantId: "tenant-a", id: "appt-a" } } }));
    expect(transaction.service.findUnique.mock.calls[0][0].where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "svc-a" } });
    expect(transaction.staff.findUnique.mock.calls[0][0].where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "staff-a" } });
    expect(transaction.profile.findUnique.mock.calls[0][0].where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "profile-a" } });
    // Minimal fields only: no customer PII.
    expect(details).toEqual({ appointmentId: "appt-a", status: "PENDING", startAt: START, endAt: END, serviceName: "Saç Kesimi", staffName: "Ali" });
  });

  it("returns null without reading the appointment when no usable token exists", async () => {
    const transaction = makeTransaction({ token: null });
    await expect(createPrismaAppointmentAccessTokenRepository(makePrisma(transaction)).findDetailsByTokenHash(TENANT, HASH, NOW)).resolves.toBeNull();
    expect(transaction.appointment.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the service or staff profile is missing", async () => {
    const transaction = makeTransaction();
    transaction.service.findUnique.mockResolvedValueOnce(null);
    await expect(createPrismaAppointmentAccessTokenRepository(makePrisma(transaction)).findDetailsByTokenHash(TENANT, HASH, NOW)).resolves.toBeNull();
  });

  it("runs the whole cancel in one tenant transaction with tenant-scoped optimistic update", async () => {
    const transaction = makeTransaction();
    const prisma = makePrisma(transaction);
    const result = await createPrismaAppointmentAccessTokenRepository(prisma).inCancelTransaction(TENANT, async (tx) => {
      const found = await tx.findByTokenHash(HASH, NOW);
      const reread = await tx.readAppointment("appt-a");
      const updated = await tx.updateStatus("appt-a", "PENDING", "CANCELLED");
      return { found, reread, updated };
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tenantGucValue(transaction)).toBe("tenant-a");
    expect(transaction.appointmentAccessToken.findFirst).toHaveBeenCalledWith({ where: usableTokenWhere, select: { appointmentId: true } });
    expect(transaction.appointment.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: "appt-a", status: "PENDING" }, data: { status: "CANCELLED" },
    });
    expect(result).toEqual({
      found: { appointmentId: "appt-a", status: "PENDING", startAt: START },
      reread: { status: "PENDING", startAt: START },
      updated: true,
    });
  });

  it("reports false when the optimistic update matched no row, and null when no usable token", async () => {
    const transaction = makeTransaction({ token: null, updateCount: 0 });
    const result = await createPrismaAppointmentAccessTokenRepository(makePrisma(transaction)).inCancelTransaction(TENANT, async (tx) => ({
      found: await tx.findByTokenHash(HASH, NOW),
      updated: await tx.updateStatus("appt-a", "CONFIRMED", "CANCELLED"),
    }));
    expect(result).toEqual({ found: null, updated: false });
  });

  it("never revokes or rewrites the token during cancel", async () => {
    const transaction = makeTransaction();
    const tokenModel = transaction.appointmentAccessToken as Record<string, unknown>;
    tokenModel.update = vi.fn();
    tokenModel.updateMany = vi.fn();
    tokenModel.delete = vi.fn();
    tokenModel.deleteMany = vi.fn();
    await createPrismaAppointmentAccessTokenRepository(makePrisma(transaction)).inCancelTransaction(TENANT, async (tx) => {
      await tx.findByTokenHash(HASH, NOW);
      return tx.updateStatus("appt-a", "PENDING", "CANCELLED");
    });
    for (const method of ["update", "updateMany", "delete", "deleteMany"]) expect(tokenModel[method]).not.toHaveBeenCalled();
  });
});
