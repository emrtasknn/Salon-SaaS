import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantRole } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import { createStaffStatus, type StaffRecord, type StaffStatus } from "../domain/staff";
import type { AuthAdminProvisioner } from "../infrastructure/auth/supabase-admin-auth";

type StaffManageRole = Extract<TenantRole, "TENANT_ADMIN" | "SUPER_ADMIN">;

export type StaffProvisioningInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  displayName: unknown;
  email?: unknown;
  phone?: unknown;
}>;

export type StaffProvisioningRepositoryInput = Readonly<{
  tenantId: string;
  subjectId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type StaffRepository = Readonly<{
  create(
    input: StaffProvisioningRepositoryInput,
  ): Promise<Readonly<{ status: "created"; staff: StaffRecord }> | Readonly<{ status: "conflict" }>>;
  updateProfile(
    tenantContext: TenantContext,
    staffId: string,
    patch: Readonly<{ displayName?: string; email?: string | null; phone?: string | null }>,
  ): Promise<"updated" | "not_found" | "conflict">;
  setStatus(
    tenantContext: TenantContext,
    staffId: string,
    status: StaffStatus,
  ): Promise<"updated" | "not_found">;
  list(tenantContext: TenantContext): Promise<ReadonlyArray<StaffRecord>>;
}>;

export type StaffManagementAuthorizer = Readonly<{
  authorize(
    identity: ApplicationIdentity,
    tenantContext: TenantContext,
    requiredRole: StaffManageRole,
  ): Promise<boolean>;
}>;

export type StaffManagementResult =
  | Readonly<{ status: "created"; staff: StaffRecord }>
  | Readonly<{ status: "updated" }>
  | Readonly<{
      status:
        | "UNAUTHORIZED"
        | "INVALID_INPUT"
        | "AUTH_PROVISIONING_FAILED"
        | "PERSISTENCE_FAILURE"
        | "COMPENSATION_FAILED"
        | "NOT_FOUND"
        | "CONFLICT";
    }>;

function optionalText(value: unknown): string | null | "INVALID" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const normalized = value.trim();
  if (!normalized || /[\\u0000-\\u001f\\u007f]/.test(normalized)) return normalized ? "INVALID" : null;
  return normalized;
}

export function createStaffManager(dependencies: Readonly<{
  authorizer: StaffManagementAuthorizer;
  authProvisioner: AuthAdminProvisioner;
  repository: StaffRepository;
}>) {
  return {
    async create(input: StaffProvisioningInput): Promise<StaffManagementResult> {
      if (!(await dependencies.authorizer.authorize(input.identity, input.tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }
      if (typeof input.displayName !== "string" || input.displayName.trim() === "") {
        return { status: "INVALID_INPUT" };
      }
      const email = optionalText(input.email);
      const phone = optionalText(input.phone);
      if (email === "INVALID" || phone === "INVALID") return { status: "INVALID_INPUT" };

      const auth = await dependencies.authProvisioner.provision({
        email,
        displayName: input.displayName.trim(),
      });
      if (auth.status === "failed") return { status: "AUTH_PROVISIONING_FAILED" };

      const persisted = await dependencies.repository.create({
        tenantId: input.tenantContext.tenantId,
        subjectId: auth.subjectId,
        displayName: input.displayName.trim(),
        email,
        phone,
      });
      if (persisted.status === "created") return persisted;

      const compensation = await dependencies.authProvisioner.compensate(auth.subjectId);
      if (compensation.status === "failed") return { status: "COMPENSATION_FAILED" };
      return { status: "CONFLICT" };
    },

    async setStatus(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      staffId: string,
      status: unknown,
    ): Promise<StaffManagementResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }
      let nextStatus: StaffStatus;
      try { nextStatus = createStaffStatus(status); } catch { return { status: "INVALID_INPUT" }; }
      const result = await dependencies.repository.setStatus(tenantContext, staffId, nextStatus);
      return result === "updated" ? { status: "updated" } : { status: "NOT_FOUND" };
    },

    async updateProfile(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      staffId: string,
      patch: Readonly<{ displayName?: unknown; email?: unknown; phone?: unknown }>,
    ): Promise<Readonly<{ status: "updated" | "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" }>> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" };
      const normalized: { displayName?: string; email?: string | null; phone?: string | null } = {};
      if ("displayName" in patch) {
        if (typeof patch.displayName !== "string" || patch.displayName.trim() === "") return { status: "INVALID_INPUT" };
        normalized.displayName = patch.displayName.trim();
      }
      for (const key of ["email", "phone"] as const) {
        if (key in patch) {
          const value = optionalText(patch[key]);
          if (value === "INVALID") return { status: "INVALID_INPUT" };
          normalized[key] = value;
        }
      }
      const result = await dependencies.repository.updateProfile(tenantContext, staffId, normalized);
      return result;
    },

    async list(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<Readonly<{ status: "listed" | "UNAUTHORIZED" | "PERSISTENCE_FAILURE"; staff?: ReadonlyArray<StaffRecord> }>> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" };
      try { return { status: "listed", staff: await dependencies.repository.list(tenantContext) }; }
      catch { return { status: "PERSISTENCE_FAILURE" }; }
    },
  };
}
