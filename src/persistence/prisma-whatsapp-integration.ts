import { withPrismaTenantContext } from "./prisma-tenant-context";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import type { TenantContext } from "../domain/tenant-context";

type SenderLookupTransaction = PrismaTenantTransactionClient & {
  $queryRaw<T>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
};

export const MAX_PHONE_NUMBER_ID_LENGTH = 64;

/**
 * WP-15: true only when this tenant has an ACTIVE Meta WhatsApp integration for
 * exactly this sender phone-number id. Runs in the tenant's RLS context and
 * also filters by tenantId, so another tenant's integration can never match.
 * Callers must treat false (and a thrown error) as "do not send WhatsApp".
 */
export async function isWhatsAppSenderBoundToTenant(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  phoneNumberId: string,
): Promise<boolean> {
  if (!phoneNumberId || phoneNumberId.length > MAX_PHONE_NUMBER_ID_LENGTH) return false;
  return withPrismaTenantContext<boolean, SenderLookupTransaction>(prisma, tenantContext, async (tx) => {
    const rows = await tx.$queryRaw<ReadonlyArray<{ bound: number }>>`
      SELECT 1 AS "bound"
        FROM "WhatsAppIntegration"
       WHERE "tenantId" = ${tenantContext.tenantId}
         AND "provider" = 'META_WHATSAPP'
         AND "phoneNumberId" = ${phoneNumberId}
         AND "status" = 'ACTIVE'
       LIMIT 1
    `;
    return rows.length > 0;
  });
}
