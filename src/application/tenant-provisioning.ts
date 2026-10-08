import { createTenantId, type TenantContext } from "../domain/tenant-context";
import type { AuthSubjectId } from "../domain/auth-identity";
import type { AuthAdminProvisioner } from "../infrastructure/auth/supabase-admin-auth";
import type { TenantAdminAuthBinding } from "./tenant-admin-auth-binding";
import {
  createTenantName,
  createTenantTimezone,
  normalizeTenantSlug,
  type TenantProvisioningData,
} from "../domain/tenant";

export type TenantProvisioningActor = Readonly<{
  kind: "SUPER_ADMIN";
  subjectId: string;
}>;

export type TenantProvisioningInput = Readonly<{
  actor: TenantProvisioningActor;
  tenant: Readonly<{
    name: unknown;
    slug?: unknown;
    timezone: unknown;
  }>;
  firstAdmin: Readonly<{
    displayName: unknown;
    email: unknown;
    password: unknown;
    phone?: unknown;
  }>;
}>;

export type TenantProvisioningRepositoryInput = Readonly<{
  tenant: TenantProvisioningData;
  firstAdmin: Readonly<{
    subjectId: string;
    displayName: string;
    email: string;
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
        | "AUTH_PROVISIONING_FAILED"
        | "AUTH_BINDING_FAILED"
        | "AUTH_BINDING_ROLLBACK_FAILED"
        | "AUTH_COMPENSATION_FAILED"
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

function requiredEmail(value: unknown): string | typeof INVALID {
  if (typeof value !== "string") return INVALID;
  const email = value.trim();
  if (email.length === 0 || email.length > 320) return INVALID;
  if (/[\u0000-\u001f\u007f]/.test(email)) return INVALID;
  if (!email.includes("@")) return INVALID;
  return email;
}

function requiredPassword(value: unknown): string | typeof INVALID {
  if (typeof value !== "string") return INVALID;
  if (value.length < 8 || value.length > 128) return INVALID;
  if (/[\u0000-\u001f\u007f]/.test(value)) return INVALID;
  return value;
}

const INVALID = Symbol("INVALID");

export function createTenantProvisioner(dependencies: Readonly<{
  authorizer: TenantProvisioningAuthorizer;
  repository: TenantProvisioningRepository;
  authProvisioner: AuthAdminProvisioner;
  authBinding: TenantAdminAuthBinding;
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
        typeof input.actor.subjectId !== "string" ||
        input.actor.subjectId.trim() !== input.actor.subjectId ||
        input.actor.subjectId.length === 0 ||
        input.actor.subjectId.length > 128
      ) {
        return { status: "INVALID_INPUT" };
      }

      if (
        typeof input.firstAdmin.displayName !== "string" ||
        input.firstAdmin.displayName.trim().length === 0
      ) {
        return { status: "INVALID_INPUT" };
      }

      const email = requiredEmail(input.firstAdmin.email);
      const password = requiredPassword(input.firstAdmin.password);
      const phone = optionalText(input.firstAdmin.phone);
      if (email === INVALID || password === INVALID || phone === INVALID) {
        return { status: "INVALID_INPUT" };
      }

      const tenantId = createTenantId(
        globalThis.crypto?.randomUUID?.() ?? "",
      );
      if (!tenantId.ok) return { status: "PERSISTENCE_FAILURE" };

      const auth = await dependencies.authProvisioner.provision({
        email,
        password,
        displayName: input.firstAdmin.displayName.trim(),
        tenantId: tenantId.value,
      });
      if (auth.status === "failed") {
        return { status: "AUTH_PROVISIONING_FAILED" };
      }

      const subjectId = auth.subjectId as AuthSubjectId;
      const binding = await dependencies.authBinding.bindTenant(
        subjectId,
        tenantId.value,
      );
      if (binding.status === "failed") {
        const compensation = await dependencies.authProvisioner.compensate(subjectId);
        return compensation.status === "failed"
          ? { status: "AUTH_COMPENSATION_FAILED" }
          : { status: "AUTH_BINDING_FAILED" };
      }

      const repositoryInput: TenantProvisioningRepositoryInput = {
        tenant: {
          tenantId: tenantId.value,
          name: name.value,
          slug: slug.value,
          timezone: timezone.value,
        },
        firstAdmin: {
          subjectId,
          displayName: input.firstAdmin.displayName.trim(),
          email,
          phone,
        },
      };

      try {
        const result = await dependencies.repository.provision(repositoryInput);

        if (result.status === "duplicate_slug") {
          const rollback =
            binding.status === "bound"
              ? await dependencies.authBinding.rollbackTenantBinding(
                  subjectId,
                  tenantId.value,
                )
              : { status: "not_owned" as const };

          if (rollback.status === "failed") {
            return { status: "AUTH_BINDING_ROLLBACK_FAILED" };
          }

          const compensation = await dependencies.authProvisioner.compensate(subjectId);
          return compensation.status === "failed"
            ? { status: "AUTH_COMPENSATION_FAILED" }
            : { status: "DUPLICATE_SLUG" };
        }

        const context = createTenantId(result.tenantId);
        if (!context.ok) return { status: "PERSISTENCE_FAILURE" };

        return {
          status: "created",
          tenantContext: Object.freeze({ tenantId: context.value }),
          profileId: result.profileId,
        };
      } catch {
        if (binding.status === "bound") {
          const rollback = await dependencies.authBinding.rollbackTenantBinding(
            subjectId,
            tenantId.value,
          );
          if (rollback.status === "failed") {
            return { status: "AUTH_BINDING_ROLLBACK_FAILED" };
          }
        }

        const compensation = await dependencies.authProvisioner.compensate(subjectId);
        return compensation.status === "failed"
          ? { status: "AUTH_COMPENSATION_FAILED" }
          : { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
