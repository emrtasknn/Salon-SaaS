import { withPrismaTenantContext } from "./prisma-tenant-context";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import type { TenantContext } from "../domain/tenant-context";

type RawQueryClient = PrismaTenantClient & {
  $queryRaw<T>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
};

export async function resolveWhatsAppTenantId(prisma: RawQueryClient, phoneNumberId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<ReadonlyArray<{ tenantId: string | null }>>`
    SELECT private.resolve_whatsapp_tenant_id(${phoneNumberId}) AS "tenantId"
  `;
  return rows[0]?.tenantId ?? null;
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
        ? await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'SENT', "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "providerMessageId" = ${status.providerMessageId} AND "status" = 'PENDING'`
        : status.status === "delivered"
          ? await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'DELIVERED', "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "providerMessageId" = ${status.providerMessageId} AND "status" IN ('PENDING', 'SENT')`
          : await tx.$executeRaw`UPDATE "NotificationDelivery" SET "status" = 'FAILED', "lastErrorCode" = ${status.errorCode ?? "WHATSAPP_PROVIDER_FAILED"}, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantContext.tenantId} AND "providerMessageId" = ${status.providerMessageId} AND "status" IN ('PENDING', 'SENT')`;
      updatedCount += Number(count);
    }
    return updatedCount;
  });
}
