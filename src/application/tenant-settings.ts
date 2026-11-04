import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { createTenantContactPhone, createTenantName, type TenantStatus } from "../domain/tenant";

/** WP-07: tenant settings visible in /admin. Status and timezone are read-only here. */
export type TenantSettings = Readonly<{
  name: string;
  contactPhone: string | null;
  status: TenantStatus;
  timezone: string;
}>;

export type TenantSettingsRepository = Readonly<{
  read(tenantContext: TenantContext): Promise<TenantSettings | null>;
  update(
    tenantContext: TenantContext,
    input: Readonly<{ name: string; contactPhone: string | null }>,
  ): Promise<"updated" | "not_found" | "persistence_failure">;
}>;

export type TenantSettingsAuthorizer = Readonly<{
  /** May read settings (admin panel access). */
  authorizeRead(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
  /** May edit settings: exactly TENANT_ADMIN of the session-resolved tenant. */
  authorizeUpdate(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
}>;

export type TenantSettingsLoadResult =
  | { ok: true; settings: TenantSettings }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "PERSISTENCE_FAILURE" };

export type TenantSettingsUpdateResult =
  | { ok: true }
  | { ok: false; code: "INVALID_TENANT_NAME" | "INVALID_CONTACT_PHONE" | "FORBIDDEN" | "PERSISTENCE_FAILURE" };

export function createTenantSettings(dependencies: Readonly<{
  repository: TenantSettingsRepository;
  authorizer: TenantSettingsAuthorizer;
}>) {
  return {
    async load(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<TenantSettingsLoadResult> {
      try {
        if (!(await dependencies.authorizer.authorizeRead(identity, tenantContext))) return { ok: false, code: "FORBIDDEN" };
        const settings = await dependencies.repository.read(tenantContext);
        if (!settings) return { ok: false, code: "NOT_FOUND" };
        return { ok: true, settings };
      } catch {
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      }
    },

    /** Only `name` and `contactPhone` are accepted; any other input (tenantId, status, timezone) is ignored. */
    async update(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      input: Readonly<{ name: unknown; contactPhone: unknown }>,
    ): Promise<TenantSettingsUpdateResult> {
      try {
        if (!(await dependencies.authorizer.authorizeUpdate(identity, tenantContext))) return { ok: false, code: "FORBIDDEN" };
      } catch {
        return { ok: false, code: "FORBIDDEN" };
      }
      const name = createTenantName(input.name);
      if (!name.ok) return { ok: false, code: "INVALID_TENANT_NAME" };
      const contactPhone = createTenantContactPhone(input.contactPhone);
      if (!contactPhone.ok) return { ok: false, code: "INVALID_CONTACT_PHONE" };
      try {
        const result = await dependencies.repository.update(tenantContext, { name: name.value, contactPhone: contactPhone.value });
        return result === "updated" ? { ok: true } : { ok: false, code: "PERSISTENCE_FAILURE" };
      } catch {
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
