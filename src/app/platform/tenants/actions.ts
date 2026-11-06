"use server";

import { readAuthenticatedPlatformRequest } from "@/application/auth-request-boundary";
import { createTenantProvisioner } from "@/application/tenant-provisioning";
import { createSupabaseTenantAdminAuthBinding } from "@/infrastructure/auth/supabase-tenant-admin-binding";
import { createSupabaseAdminAuthProvisioner } from "@/infrastructure/auth/supabase-admin-auth";
import { createNextSupabaseServerClient } from "@/infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "@/infrastructure/auth/supabase-server-env";
import { createSupabaseAuthAdapter } from "@/infrastructure/auth/supabase-auth-adapter";
import { logError } from "@/infrastructure/log-redaction";
import { getPrisma } from "@/infrastructure/prisma-runtime";
import { createPrismaTenantProvisioningRepository } from "@/persistence/prisma-tenant-provisioning";
import {
  createPlatformTenantStatus,
  type PlatformActor,
  type PlatformTenantListResult,
  type PlatformTenantStatusResult,
} from "@/application/platform-tenant-status";
import { createPrismaPlatformTenantRepository } from "@/persistence/prisma-platform-tenants";

export async function readPlatformAccess() {
  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );

  const context = await readAuthenticatedPlatformRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );

  return context.state === "authenticated";
}

export async function createTenantAction(input: {
  name: string;
  slug: string;
  timezone: string;
  firstAdminDisplayName: string;
  firstAdminEmail: string;
  firstAdminPassword: string;
  firstAdminPhone?: string;
}) {
  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );
  const context = await readAuthenticatedPlatformRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );

  if (context.state !== "authenticated") {
    return { status: "UNAUTHORIZED" as const };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return { status: "CONFIGURATION_ERROR" as const };
  }

  const provisioner = createTenantProvisioner({
    authorizer: {
      async authorize(actor) {
        return actor.kind === "SUPER_ADMIN" &&
          actor.subjectId === context.identity.subjectId
          ? { allowed: true as const }
          : { allowed: false as const };
      },
    },
    repository: createPrismaTenantProvisioningRepository(getPrisma()),
    authProvisioner: createSupabaseAdminAuthProvisioner({
      url,
      serviceRoleKey,
    }),
    authBinding: createSupabaseTenantAdminAuthBinding({
      url,
      serviceRoleKey,
    }),
  });

  return provisioner.provision({
    actor: {
      kind: "SUPER_ADMIN",
      subjectId: context.identity.subjectId,
    },
    tenant: {
      name: input.name,
      slug: input.slug,
      timezone: input.timezone,
    },
    firstAdmin: {
      displayName: input.firstAdminDisplayName,
      email: input.firstAdminEmail,
      password: input.firstAdminPassword,
      phone: input.firstAdminPhone,
    },
  });
}

async function readPlatformActor(): Promise<PlatformActor> {
  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );
  const context = await readAuthenticatedPlatformRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );
  return context.state === "authenticated"
    ? { kind: "SUPER_ADMIN", subjectId: context.identity.subjectId }
    : null;
}

function platformTenants() {
  return createPlatformTenantStatus({
    repository: createPrismaPlatformTenantRepository(getPrisma()),
    reportError: (event, error) => logError(event, { error }),
  });
}

/** WP-07: SUPER_ADMIN-only tenant list for the platform status toggle. */
export async function listPlatformTenants(): Promise<PlatformTenantListResult> {
  try {
    return await platformTenants().list(await readPlatformActor());
  } catch (error) {
    logError("platform_tenant_list_failed", { error });
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }
}

/** WP-07: SUPER_ADMIN-only ACTIVE/INACTIVE toggle; validates the enum and tenant existence. */
export async function setTenantStatusAction(
  formData: FormData,
): Promise<PlatformTenantStatusResult> {
  try {
    const actor = await readPlatformActor();
    if (!actor) return { ok: false, code: "FORBIDDEN" };
    if (!(formData instanceof FormData)) return { ok: false, code: "INVALID_INPUT" };
    return await platformTenants().setStatus(actor, {
      tenantId: formData.get("tenantId"),
      status: formData.get("status"),
    });
  } catch {
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }
}
