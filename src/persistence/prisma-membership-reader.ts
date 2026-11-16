import type { AuthenticatedSubjectIdentity } from "../domain/auth-identity";
import type { AuthorizationMembership } from "../domain/authorization";
import type { MembershipLookupInput, MembershipLookupResult, MembershipReader } from "./membership";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type MembershipRow = Readonly<{ tenantId:string; subjectId:string; profileId:string; role:AuthorizationMembership["role"] }>;
function toMembership(row: MembershipRow): AuthorizationMembership {
  return Object.freeze({ tenantId: row.tenantId as AuthorizationMembership["tenantId"], subjectId: row.subjectId as AuthenticatedSubjectIdentity["subjectId"], profileId: row.profileId, role: row.role });
}
type TenantReadTransaction = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string }; select: { deletedAt: true } }): Promise<{ deletedAt: Date | null } | null> };
};
export type PrismaMembershipReaderDependencies = Readonly<{ prisma: PrismaTenantClient }>;
export function createPrismaMembershipReader(dependencies: PrismaMembershipReaderDependencies): MembershipReader {
  return { async readMembership(input: MembershipLookupInput): Promise<MembershipLookupResult> {
    try {
      const row = await withPrismaTenantContext(dependencies.prisma, input.tenantContext, async (tx: TenantReadTransaction) => {
        const membership = await tx.tenantMembership.findUnique({ where: { tenantId_subjectId: { tenantId: input.tenantContext.tenantId, subjectId: input.identity.subjectId } } });
        if (membership === null) return null;
        // Read filter only: an archived (soft-deleted) tenant has no resolvable membership. Fails closed if the tenant row is unreadable.
        const tenant = await tx.tenant.findUnique({ where: { id: input.tenantContext.tenantId }, select: { deletedAt: true } });
        if (tenant === null || tenant.deletedAt !== null) return null;
        return membership;
      });
      if (row === null) return { status: "not_found" };
      return { status: "found", membership: toMembership(row) };
    } catch { return { status: "error", error: "PERSISTENCE_FAILURE" }; }
  }};
}
