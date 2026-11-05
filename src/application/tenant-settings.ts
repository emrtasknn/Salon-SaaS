import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import {
  createTenantContactPhone, createTenantKvkkContactEmail, createTenantLegalAddress, createTenantLegalName, createTenantName,
  type TenantStatus,
} from "../domain/tenant";

/** WP-10: KVKK controller identity (null = not set; booking form stays closed until all three are set). */
export type TenantLegalSettings = Readonly<{
  legalName: string | null;
  legalAddress: string | null;
  kvkkContactEmail: string | null;
}>;

/** WP-07: tenant settings visible in /admin. Status and timezone are read-only here. */
export type TenantSettings = Readonly<{
  name: string;
  contactPhone: string | null;
  status: TenantStatus;
  timezone: string;
  legal: TenantLegalSettings;
}>;

export type TenantSettingsRepository = Readonly<{
  read(tenantContext: TenantContext): Promise<TenantSettings | null>;
  update(
    tenantContext: TenantContext,
    /** A legal key that is absent (undefined) is left unchanged; null clears it. */
    input: Readonly<{ name: string; contactPhone: string | null } & Partial<TenantLegalSettings>>,
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
  | { ok: false; code:
    | "INVALID_TENANT_NAME" | "INVALID_CONTACT_PHONE"
    | "INVALID_LEGAL_NAME" | "INVALID_LEGAL_ADDRESS" | "INVALID_KVKK_EMAIL"
    | "FORBIDDEN" | "PERSISTENCE_FAILURE" };

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

    /**
     * Only `name`, `contactPhone` and (WP-10) the legal fields are accepted; any other input
     * (tenantId, status, timezone) is ignored. A legal field passed as `undefined` stays unchanged.
     */
    async update(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      input: Readonly<{ name: unknown; contactPhone: unknown; legalName?: unknown; legalAddress?: unknown; kvkkContactEmail?: unknown }>,
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
      const legal: { -readonly [K in keyof TenantLegalSettings]?: string | null } = {};
      if (input.legalName !== undefined) {
        const legalName = createTenantLegalName(input.legalName);
        if (!legalName.ok) return { ok: false, code: "INVALID_LEGAL_NAME" };
        legal.legalName = legalName.value;
      }
      if (input.legalAddress !== undefined) {
        const legalAddress = createTenantLegalAddress(input.legalAddress);
        if (!legalAddress.ok) return { ok: false, code: "INVALID_LEGAL_ADDRESS" };
        legal.legalAddress = legalAddress.value;
      }
      if (input.kvkkContactEmail !== undefined) {
        const kvkkContactEmail = createTenantKvkkContactEmail(input.kvkkContactEmail);
        if (!kvkkContactEmail.ok) return { ok: false, code: "INVALID_KVKK_EMAIL" };
        legal.kvkkContactEmail = kvkkContactEmail.value;
      }
      try {
        const result = await dependencies.repository.update(tenantContext, { name: name.value, contactPhone: contactPhone.value, ...legal });
        return result === "updated" ? { ok: true } : { ok: false, code: "PERSISTENCE_FAILURE" };
      } catch {
        return { ok: false, code: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
