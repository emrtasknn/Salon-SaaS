import type { TenantContext } from "../domain/tenant-context";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

export type StaffLookupRecord = { id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" };

type StaffLookupTx = PrismaTenantTransactionClient & {
  staff: {
    findUnique(args: { where: { tenantId_profileId: { tenantId: string; profileId: string } } }): Promise<StaffLookupRecord | null>;
  };
};

/**
 * Staff row of a profile in the trusted tenant. Runs inside withPrismaTenantContext so it
 * also works under a NOBYPASSRLS runtime role (Staff is FORCE RLS on app.tenant_id).
 */
export function findStaffByProfileId(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  profileId: string,
): Promise<StaffLookupRecord | null> {
  return withPrismaTenantContext(prisma, tenantContext, async (tx: StaffLookupTx) =>
    tx.staff.findUnique({ where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId } } }),
  );
}
