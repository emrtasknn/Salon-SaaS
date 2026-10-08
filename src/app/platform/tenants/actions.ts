"use server";

import { readAuthenticatedPlatformRequest } from "@/application/auth-request-boundary";
import { createTenantProvisioner } from "@/application/tenant-provisioning";
import { createSupabaseTenantAdminAuthBinding } from "@/infrastructure/auth/supabase-tenant-admin-binding";
import { createSupabaseAdminAuthProvisioner } from "@/infrastructure/auth/supabase-admin-auth";
import { createNextSupabaseServerClient } from "@/infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "@/infrastructure/auth/supabase-server-env";
import { createSupabaseAuthAdapter } from "@/infrastructure/auth/supabase-auth-adapter";
import { getPrisma } from "@/infrastructure/prisma-runtime";
import { createPrismaTenantProvisioningRepository } from "@/persistence/prisma-tenant-provisioning";

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
