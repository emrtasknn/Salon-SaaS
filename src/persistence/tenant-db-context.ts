import type { TenantContext } from "../domain/tenant-context";

export interface TenantDatabaseClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T>;
}

export async function withTenantDatabaseContext<T>(
  client: TenantDatabaseClient,
  tenantContext: TenantContext,
  operation: (client: TenantDatabaseClient) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");

  try {
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [tenantContext.tenantId],
    );

    const result = await operation(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original operation error.
    }

    throw error;
  }
}
