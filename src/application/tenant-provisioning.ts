import { createTenantId, type TenantContext } from "../domain/tenant-context";
import {
  createTenantName,
  createTenantTimezone,
  normalizeTenantSlug,
  type TenantProvisioningData,
} from "../domain/tenant";

export type TenantProvisioningActor =
  | Readonly<{ kind: "SUPER_ADMIN"; subjectId: string }>
  | Readonly<{ kind: "TENANT_ONBOARDING"; subjectId: string }>;

export type TenantProvisioningInput = Readonly<{
  actor: TenantProvisioningActor;
  tenant: Readonly<{
    name: unknown;
    slug?: unknown;
    timezone: unknown;
  }>;
  firstAdmin: Readonly<{
    subjectId: unknown;
    displayName: unknown;
    email?: unknown;
    phone?: unknown;
  }>;
}>;

export type TenantProvisioningRepositoryInput = Readonly<{
  tenant: TenantProvisioningData;
  firstAdmin: Readonly<{
    subjectId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
  }>;
}>;

export type TenantProvisioningRepositoryResult =
  | Readonly<{
      status: "created";
      tenantId: string;
      profileId: string;
    }>
  | Readonly<{ status: "duplicate_slug" }>;

export interface TenantProvisioningAuthorizer {
  authorize(
    actor: TenantProvisioningActor,
  ): Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false }>>;
}

export interface TenantProvisioningRepository {
  provision(
    input: TenantProvisioningRepositoryInput,
  ): Promise<TenantProvisioningRepositoryResult>;
}

export type TenantProvisioningResult =
  | Readonly<{ status: "created"; tenantContext: TenantContext; profileId: string }>
  | Readonly<{
      status:
        | "UNAUTHORIZED"
        | "INVALID_INPUT"
        | "DUPLICATE_SLUG"
        | "PERSISTENCE_FAILURE";
    }>;

function optionalText(
  value: unknown,
): string | null | typeof INVALID {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return INVALID;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return INVALID;
  return normalized;
}

const INVALID = Symbol("INVALID");

export function createTenantProvisioner(dependencies: Readonly<{
  authorizer: TenantProvisioningAuthorizer;
  repository: TenantProvisioningRepository;
}>) {
  return {
    async provision(
      input: TenantProvisioningInput,
    ): Promise<TenantProvisioningResult> {
      const authorization = await dependencies.authorizer.authorize(input.actor);
      if (!authorization.allowed) return { status: "UNAUTHORIZED" };

      const name = createTenantName(input.tenant.name);
      const timezone = createTenantTimezone(input.tenant.timezone);
      const slug = normalizeTenantSlug(
        input.tenant.slug ?? input.tenant.name,
      );

      if (!name.ok || !timezone.ok || !slug.ok) {
        return { status: "INVALID_INPUT" };
      }

      if (
        typeof input.firstAdmin.subjectId !== "string" ||
        input.firstAdmin.subjectId.trim() !== input.firstAdmin.subjectId ||
        input.firstAdmin.subjectId.length === 0 ||
        input.firstAdmin.subjectId.length > 128
      ) {
        return { status: "INVALID_INPUT" };
      }

      if (
        typeof input.firstAdmin.displayName !== "string" ||
        input.firstAdmin.displayName.trim().length === 0
      ) {
        return { status: "INVALID_INPUT" };
      }

      const email = optionalText(input.firstAdmin.email);
      const phone = optionalText(input.firstAdmin.phone);
      if (email === INVALID || phone === INVALID) {
        return { status: "INVALID_INPUT" };
      }

      const tenantId = createTenantId(
        globalThis.crypto?.randomUUID?.() ?? "",
      );
      if (!tenantId.ok) return { status: "PERSISTENCE_FAILURE" };

      const repositoryInput: TenantProvisioningRepositoryInput = {
        tenant: {
          tenantId: tenantId.value,
          name: name.value,
          slug: slug.value,
          timezone: timezone.value,
        },
        firstAdmin: {
          subjectId: input.firstAdmin.subjectId,
          displayName: input.firstAdmin.displayName.trim(),
          email,
          phone,
        },
      };

      try {
        const result = await dependencies.repository.provision(repositoryInput);

        if (result.status === "duplicate_slug") {
          return { status: "DUPLICATE_SLUG" };
        }

        const context = createTenantId(result.tenantId);
        if (!context.ok) return { status: "PERSISTENCE_FAILURE" };

        return {
          status: "created",
          tenantContext: Object.freeze({ tenantId: context.value }),
          profileId: result.profileId,
        };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}