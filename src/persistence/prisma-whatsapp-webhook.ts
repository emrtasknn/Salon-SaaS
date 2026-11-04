import { withPrismaTenantContext } from "./prisma-tenant-context";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { createTenantId, type TenantContext, type TenantId } from "../domain/tenant-context";

type RawQueryClient = PrismaTenantClient & {
  $queryRaw<T>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
};

// Mirrors the cap in private.resolve_whatsapp_delivery_tenant_id (WP-02c).
export const MAX_PROVIDER_MESSAGE_ID_LENGTH = 256;

function toTenantId(rows: ReadonlyArray<{ tenantId: string | null }>): TenantId | null {
  const tenantId = rows[0]?.tenantId ?? null;
  if (!tenantId) return null;

  const tenantIdResult = createTenantId(tenantId);
  return tenantIdResult.ok ? tenantIdResult.value : null;
}

export async function resolveWhatsAppTenantId(prisma: RawQueryClient, phoneNumberId: string): Promise<TenantId | null> {
  const rows = await prisma.$queryRaw<ReadonlyArray<{ tenantId: string | null }>>`
    SELECT private.resolve_whatsapp_tenant_id(${phoneNumberId}) AS "tenantId"
  `;
  return toTenantId(rows);
}

/**
 * WP-02c (Option A): resolves the tenant that owns a WhatsApp delivery by its
 * provider message id (wamid). Used only for the shared platform sender. The
 * SQL function returns a tenant id only when exactly one tenant matches;
 * otherwise NULL (fail closed).
 */
export async function resolveWhatsAppDeliveryTenantId(prisma: RawQueryClient, providerMessageId: string): Promise<TenantId | null> {
  if (!providerMessageId || providerMessageId.length > MAX_PROVIDER_MESSAGE_ID_LENGTH) return null;
  const rows = await prisma.$queryRaw<ReadonlyArray<{ tenantId: string | null }>>`
    SELECT private.resolve_whatsapp_delivery_tenant_id(${providerMessageId}) AS "tenantId"
  `;
  return toTenantId(rows);
}

export async function applyWhatsAppWebhookStatuses(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  statuses: ReadonlyArray<{ providerMessageId: string; status: "sent" | "delivered" | "failed" | "read"; errorCode?: string }>,
): Promise<number> {
  return withPrismaTenantContext(prisma, tenantContext, async (tx) => {
    let updatedCount = 0;
    for (const status of statuses) {
      if (status.status === "read") continue;
      const count = status.status === "sent"
        ? await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'SENT', "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "channel" = 'WHATSAPP' AND "providerMessageId" = ${status.providerMessageId} AND "status" IN ('PENDING', 'UNKNOWN')`
        : status.status === "delivered"
          ? await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'DELIVERED', "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "channel" = 'WHATSAPP' AND "providerMessageId" = ${status.providerMessageId} AND "status" IN ('PENDING', 'SENT', 'UNKNOWN')`
          : await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'FAILED', "lastErrorCode" = ${status.errorCode ?? "WHATSAPP_PROVIDER_FAILED"}, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "channel" = 'WHATSAPP' AND "providerMessageId" = ${status.providerMessageId} AND "status" IN ('PENDING', 'SENT', 'UNKNOWN')`;
      updatedCount += Number(count);
    }
    return updatedCount;
  });
}
