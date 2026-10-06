import "server-only";
import type { AuthSubjectId } from "../../domain/auth-identity";
import type {
  TenantAdminAuthBinding,
  TenantAdminAuthBindingResult,
} from "../../application/tenant-admin-auth-binding";

type UserPayload = Readonly<{
  app_metadata?: unknown;
}>;

export type SupabaseTenantAdminAuthBindingConfig = Readonly<{
  url: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
}>;

function endpoint(config: SupabaseTenantAdminAuthBindingConfig, subjectId: string): string {
  return `${config.url.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(subjectId)}`;
}

function headers(config: SupabaseTenantAdminAuthBindingConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function metadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

async function readMetadata(
  fetcher: typeof fetch,
  config: SupabaseTenantAdminAuthBindingConfig,
  subjectId: AuthSubjectId,
): Promise<
  | { status: "ok"; metadata: Record<string, unknown> }
  | { status: "failed"; reason: "PROVIDER_REJECTED" | "NETWORK_FAILURE" }
> {
  try {
    const response = await fetcher(endpoint(config, subjectId), {
      method: "GET",
      headers: headers(config),
    });
    if (!response.ok) return { status: "failed", reason: "PROVIDER_REJECTED" };
    const payload: unknown = await response.json();
    const value = metadata((payload as UserPayload).app_metadata);
    return { status: "ok", metadata: value ?? {} };
  } catch {
    return { status: "failed", reason: "NETWORK_FAILURE" };
  }
}

async function writeMetadata(
  fetcher: typeof fetch,
  config: SupabaseTenantAdminAuthBindingConfig,
  subjectId: AuthSubjectId,
  appMetadata: Record<string, unknown>,
): Promise<"ok" | "failed"> {
  try {
    const response = await fetcher(endpoint(config, subjectId), {
      method: "PUT",
      headers: headers(config),
      body: JSON.stringify({ app_metadata: appMetadata }),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export function createSupabaseTenantAdminAuthBinding(
  config: SupabaseTenantAdminAuthBindingConfig,
): TenantAdminAuthBinding {
  const fetcher = config.fetcher ?? fetch;

  return {
    async bindTenant(subjectId, tenantId) {
      if (!config.url || !config.serviceRoleKey) {
        return { status: "failed", reason: "INVALID_CONFIGURATION" };
      }
      if (!tenantId || tenantId.length > 128 || /[\u0000-\u001f\u007f]/.test(tenantId)) {
        return { status: "failed", reason: "INVALID_INPUT" };
      }

      const current = await readMetadata(fetcher, config, subjectId);
      if (current.status === "failed") return current;

      const existingTenantId = current.metadata.tenant_id;
      if (existingTenantId !== undefined && existingTenantId !== tenantId) {
        return { status: "failed", reason: "CONFLICT" };
      }
      if (existingTenantId === tenantId) return { status: "already_bound" };

      const result = await writeMetadata(fetcher, config, subjectId, {
        ...current.metadata,
        tenant_id: tenantId,
      });
      return result === "ok"
        ? { status: "bound" }
        : { status: "failed", reason: "PROVIDER_REJECTED" };
    },

    async rollbackTenantBinding(subjectId, tenantId) {
      if (!config.url || !config.serviceRoleKey) return { status: "failed" };

      const current = await readMetadata(fetcher, config, subjectId);
      if (current.status === "failed") return { status: "failed" };
      if (current.metadata.tenant_id !== tenantId) return { status: "not_owned" };

      const next = { ...current.metadata };
      delete next.tenant_id;
      return (await writeMetadata(fetcher, config, subjectId, next)) === "ok"
        ? { status: "rolled_back" }
        : { status: "failed" };
    },
  };
}
