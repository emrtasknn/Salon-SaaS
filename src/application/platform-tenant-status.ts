import { isTenantStatus, type TenantStatus } from "../domain/tenant";

/** WP-07: platform-level (SUPER_ADMIN) tenant listing and status toggle. */
export type PlatformTenantSummary = Readonly<{ id: string; slug: string; name: string; status: TenantStatus }>;

export type PlatformTenantRepository = Readonly<{
  list(): Promise<ReadonlyArray<PlatformTenantSummary>>;
  setStatus(tenantId: string, status: TenantStatus): Promise<"updated" | "not_found" | "persistence_failure">;
}>;

export type PlatformActor = Readonly<{ kind: "SUPER_ADMIN"; subjectId: string }> | null;

export type PlatformTenantListResult =
  | { ok: true; tenants: PlatformTenantSummary[] }
  | { ok: false; code: "FORBIDDEN" | "PERSISTENCE_FAILURE" };

export type PlatformTenantStatusResult =
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "PERSISTENCE_FAILURE" };

const TENANT_ID_MAX_LENGTH = 100;

function isSuperAdmin(actor: PlatformActor): boolean {
  return actor !== null && actor.kind === "SUPER_ADMIN" && typeof actor.subjectId === "string" && actor.subjectId.length > 0;
}

export type PlatformErrorReporter = (event: string, error: unknown) => void;

export function createPlatformTenantStatus(
  dependencies: Readonly<{ repository: PlatformTenantRepository; reportError?: PlatformErrorReporter }>,
) {
  return {
    async list(actor: PlatformActor): Promise<PlatformTenantListResult> {
      if (!isSuperAdmin(actor)) return { ok: false, code: "FORBIDDEN" };
      try {
        return { ok: true, tenants: [...(await dependencies.repository.list())] };
      } catch (error) {
        try {
          dependencies.reportError?.("platform_tenant_list_failed", error);
        } catch {
          // Reporting must not change the result.
        }
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      }
    },

    async setStatus(actor: PlatformActor, input: Readonly<{ tenantId: unknown; status: unknown }>): Promise<PlatformTenantStatusResult> {
      if (!isSuperAdmin(actor)) return { ok: false, code: "FORBIDDEN" };
      const { tenantId, status } = input;
      if (
        typeof tenantId !== "string" || tenantId.length === 0 || tenantId !== tenantId.trim() ||
        tenantId.length > TENANT_ID_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(tenantId) ||
        !isTenantStatus(status)
      ) {
        return { ok: false, code: "INVALID_INPUT" };
      }
      try {
        const result = await dependencies.repository.setStatus(tenantId, status);
        if (result === "updated") return { ok: true };
        if (result === "not_found") return { ok: false, code: "NOT_FOUND" };
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      } catch {
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
