import type { TenantContext } from "../domain/tenant-context";

export interface PrismaTenantTransaction {
  $executeRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<T>;
}

export interface PrismaTenantTransactionClient extends PrismaTenantTransaction {
  tenantMembership: {
    findUnique(args: {
      where: {
        tenantId_subjectId: {
          tenantId: string;
          subjectId: string;
        };
      };
    }): Promise<{
      tenantId: string;
      subjectId: string;
      profileId: string;
      role: "SUPER_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER";
    } | null>;
  };
}

export interface PrismaTenantClient {
  $transaction<T>(
    operation: (tx: PrismaTenantTransactionClient) => Promise<T>,
  ): Promise<T>;
}

export async function withPrismaTenantContext<T>(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  operation: (tx: PrismaTenantTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantContext.tenantId}, true)`;
    return operation(tx);
  });
}
