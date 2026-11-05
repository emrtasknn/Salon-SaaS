"use server";

import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import {
  createTenantSettings,
  type TenantSettingsLoadResult,
  type TenantSettingsUpdateResult,
} from "../../application/tenant-settings";
import { createAuthenticatedIdentity, type ApplicationIdentity } from "../../domain/auth-identity";
import type { TenantContext } from "../../domain/tenant-context";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { createPrismaTenantSettingsRepository } from "../../persistence/prisma-tenant-settings";

/**
 * WP-07 tenant settings. Tenant always comes from the authenticated session
 * (readAuthenticatedTenantRequest); no tenant identifier is read from input.
 */
async function getSessionContext() {
  const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
  const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
  if (request.state !== "authenticated") return null;
  const prisma = getPrisma();
  const reader = createPrismaMembershipReader({ prisma });
  const membership = await reader.readMembership({ tenantContext: request.tenantContext, identity: request.identity });
  if (membership.status !== "found") return null;
  return {
    prisma,
    reader,
    tenantContext: request.tenantContext,
    role: membership.membership.role,
    identity: createAuthenticatedIdentity(request.identity.subjectId, membership.membership.profileId),
  };
}

function settingsService(context: NonNullable<Awaited<ReturnType<typeof getSessionContext>>>) {
  // Re-read the membership at decision time; roles are checked exactly (no hierarchy).
  async function roleOf(identity: ApplicationIdentity, tenantContext: TenantContext) {
    if (identity.state !== "authenticated") return null;
    const membership = await context.reader.readMembership({ tenantContext, identity });
    if (membership.status !== "found" || membership.membership.profileId !== identity.profileId) return null;
    return membership.membership.role;
  }
  return createTenantSettings({
    repository: createPrismaTenantSettingsRepository(context.prisma),
    authorizer: {
      async authorizeRead(identity, tenantContext) {
        const role = await roleOf(identity, tenantContext);
        return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
      },
      // WP-07 acceptance: only TENANT_ADMIN of the session tenant may edit settings.
      async authorizeUpdate(identity, tenantContext) {
        return (await roleOf(identity, tenantContext)) === "TENANT_ADMIN";
      },
    },
  });
}

/** `canEdit` is a UI hint only; updateTenantSettingsAction re-checks the role server-side. */
export async function loadTenantSettings(): Promise<TenantSettingsLoadResult & { canEdit?: boolean }> {
  try {
    const context = await getSessionContext();
    if (!context) return { ok: false, code: "FORBIDDEN" };
    const result = await settingsService(context).load(context.identity, context.tenantContext);
    return result.ok ? { ...result, canEdit: context.role === "TENANT_ADMIN" } : result;
  } catch {
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }
}

/**
 * Accepts only `name`, `contactPhone`, (WP-10) `legalName`, `legalAddress`, `kvkkContactEmail` and the
 * location fields `publicAddress`, `mapsUrl`; status and timezone are not writable here. A legal or
 * location field missing from the form stays unchanged.
 */
export async function updateTenantSettingsAction(formData: FormData): Promise<TenantSettingsUpdateResult> {
  try {
    const context = await getSessionContext();
    if (!context) return { ok: false, code: "FORBIDDEN" };
    const input = formData instanceof FormData
      ? {
        name: formData.get("name"), contactPhone: formData.get("contactPhone"),
        legalName: formData.get("legalName") ?? undefined,
        legalAddress: formData.get("legalAddress") ?? undefined,
        kvkkContactEmail: formData.get("kvkkContactEmail") ?? undefined,
        publicAddress: formData.get("publicAddress") ?? undefined,
        mapsUrl: formData.get("mapsUrl") ?? undefined,
      }
      : { name: undefined, contactPhone: undefined };
    return await settingsService(context).update(context.identity, context.tenantContext, input);
  } catch {
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }
}
