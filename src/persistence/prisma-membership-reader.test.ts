import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedSubjectIdentity } from "../domain/auth-identity";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import { createPrismaMembershipReader } from "./prisma-membership-reader";

function tenantContext(value: string) {
  const id = createTenantId(value);
  if (!id.ok) throw new Error(id.error.message);
  const context = createTenantContext({ tenantId: id.value });
  if (!context.ok) throw new Error(context.error.message);
  return context.value;
}

describe("Prisma MembershipReader tenant context", () => {
  it("sets tenant context before the membership query", async () => {
    const findUnique = vi.fn().mockResolvedValue({ tenantId:"tenant-a", subjectId:"subject-1", profileId:"profile-1", role:"STAFF" });
    const executeRaw = vi.fn().mockResolvedValue(1);
    const transaction = vi.fn(async <T>(operation: (tx: { $executeRawUnsafe: typeof executeRaw; tenantMembership: { findUnique: typeof findUnique } }) => Promise<T>) => operation({ $executeRawUnsafe: executeRaw, tenantMembership: { findUnique } }));
    const prisma = { $transaction: transaction } as unknown as import("./prisma-tenant-context").PrismaTenantClient;
    const reader = createPrismaMembershipReader({ prisma });
    const result = await reader.readMembership({ tenantContext: tenantContext("tenant-a"), identity: createAuthenticatedSubjectIdentity("subject-1") });
    expect(result.status).toBe("found");
    expect(executeRaw).toHaveBeenCalledWith("SELECT set_config('app.tenant_id', $1, true)", "tenant-a");
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]);
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId_subjectId: { tenantId:"tenant-a", subjectId:"subject-1" } } });
  });
  it("fails closed when the transaction fails", async () => {
    const prisma = { $transaction: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const reader = createPrismaMembershipReader({ prisma });
    await expect(reader.readMembership({ tenantContext: tenantContext("tenant-a"), identity: createAuthenticatedSubjectIdentity("subject-1") })).resolves.toEqual({ status:"error", error:"PERSISTENCE_FAILURE" });
  });
  it("has no unscoped persistence fallback", async () => {
    const transaction = vi.fn().mockResolvedValue(null);
    const reader = createPrismaMembershipReader({ prisma: { $transaction: transaction } });
    await reader.readMembership({ tenantContext: tenantContext("tenant-b"), identity: createAuthenticatedSubjectIdentity("subject-2") });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
