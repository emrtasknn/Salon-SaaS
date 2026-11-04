import { isTenantStatus, type TenantStatus } from "../domain/tenant";

export interface TenantStatusQueryTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
}

/**
 * WP-07: reads Tenant.status inside the caller's booking transaction with
 * `FOR SHARE`, so a concurrent status toggle (UPDATE) serializes after any
 * in-flight booking and a booking started after the toggle sees INACTIVE.
 * Returns null when the tenant row does not exist or the value is unknown.
 */
export async function readTenantStatusForShare(
  tx: TenantStatusQueryTransaction,
  tenantId: string,
): Promise<TenantStatus | null> {
  const rows = await tx.$queryRaw<Array<{ status: unknown }>>`SELECT "status"::text AS "status" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE`;
  const status = Array.isArray(rows) ? rows[0]?.status : undefined;
  return isTenantStatus(status) ? status : null;
}
