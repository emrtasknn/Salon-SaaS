import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../domain/tenant-context";
import { isWhatsAppSenderBoundToTenant } from "./prisma-whatsapp-integration";

function fakePrisma(rows: ReadonlyArray<unknown>) {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const transaction = vi.fn(async (operation: (tx: { $executeRaw: typeof executeRaw; $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
    operation({ $executeRaw: executeRaw, $queryRaw: queryRaw }));
  return { $transaction: transaction, executeRaw, queryRaw, transaction };
}

function tenant(value: string) {
  const result = createTenantId(value);
  if (!result.ok) throw new Error("test tenant id must be valid");
  return { tenantId: result.value };
}

describe("isWhatsAppSenderBoundToTenant (WP-15)", () => {
  it("is true when the tenant has an ACTIVE integration row for the sender", async () => {
    const prisma = fakePrisma([{ bound: 1 }]);
    await expect(isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "phone-a")).resolves.toBe(true);
  });

  it("is false when no row matches", async () => {
    const prisma = fakePrisma([]);
    await expect(isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "phone-a")).resolves.toBe(false);
  });

  it("sets the tenant context first and filters by tenant, provider, sender and ACTIVE status with bound parameters", async () => {
    const prisma = fakePrisma([{ bound: 1 }]);
    await isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "phone-a");

    expect(prisma.executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.executeRaw.mock.calls[0].slice(1)).toEqual(["tenant-a"]);
    expect(prisma.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.queryRaw.mock.invocationCallOrder[0]);

    const [strings, ...values] = prisma.queryRaw.mock.calls[0];
    const sql = (strings as string[]).join("?");
    expect(sql).toContain(`"tenantId" = ?`);
    expect(sql).toContain(`"provider" = 'META_WHATSAPP'`);
    expect(sql).toContain(`"phoneNumberId" = ?`);
    expect(sql).toContain(`"status" = 'ACTIVE'`);
    expect(sql).not.toContain("phone-a");
    expect(values).toEqual(["tenant-a", "phone-a"]);
  });

  it("rejects an empty or oversized sender id without querying", async () => {
    const prisma = fakePrisma([{ bound: 1 }]);
    await expect(isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "")).resolves.toBe(false);
    await expect(isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "9".repeat(65))).resolves.toBe(false);
    expect(prisma.transaction).not.toHaveBeenCalled();
  });

  it("propagates a database error so the caller can fail closed", async () => {
    const prisma = fakePrisma([]);
    prisma.queryRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(isWhatsAppSenderBoundToTenant(prisma as never, tenant("tenant-a"), "phone-a")).rejects.toThrow("db down");
  });
});
