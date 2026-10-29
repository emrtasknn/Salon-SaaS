import type { WhatsAppIntegrationProvisioningRepository } from "../application/whatsapp-integration-provisioning";
import { createTenantContext } from "../domain/tenant-context";
import type { PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  whatsappIntegration: {
    create(args: {
      data: {
        id?: string;
        tenantId: string;
        provider: string;
        phoneNumberId: string;
      };
    }): Promise<{ id: string }>;
  };
};

export interface PrismaWhatsAppIntegrationProvisioningClient {
  $transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T>;
}

export function createPrismaWhatsAppIntegrationProvisioningRepository(
  prisma: PrismaWhatsAppIntegrationProvisioningClient,
): WhatsAppIntegrationProvisioningRepository {
  return {
    async create(input) {
      const tenantContextResult = createTenantContext({ tenantId: input.tenantId });
      if (!tenantContextResult.ok) {
        return { status: "persistence_failure" as const };
      }

      return withPrismaTenantContext(
        prisma,
        tenantContextResult.value,
        async (tx: Tx) => {
          try {
            await tx.whatsappIntegration.create({
              data: {
                id: globalThis.crypto?.randomUUID?.() ?? "",
                tenantId: input.tenantId,
                provider: input.provider,
                phoneNumberId: input.phoneNumberId,
              },
            });
            return { status: "created" as const };
          } catch (error) {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "P2002"
            ) {
              return { status: "duplicate" as const };
            }
            return { status: "persistence_failure" as const };
          }
        },
      );
    },
  };
}
