import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantRole } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  createStaffStatus,
  type StaffRecord,
  type StaffStatus,
} from "../domain/staff";
import type { AuthAdminProvisioner } from "../infrastructure/auth/supabase-admin-auth";
import type { TenantAdminAuthBinding } from "./tenant-admin-auth-binding";

type StaffManageRole = Extract<TenantRole, "TENANT_ADMIN" | "SUPER_ADMIN">;

export type StaffProvisioningInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  displayName: unknown;
  email?: unknown;
  phone?: unknown;
  /** Optional temporary password set by the tenant admin (8-128 chars, needs email). Never persisted by us. */
  password?: unknown;
}>;

export type StaffProvisioningRepositoryInput = Readonly<{
  tenantId: string;
  subjectId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type StaffListRecord = StaffRecord &
  Readonly<{
    displayName: string;
    phone: string | null;
  }>;

export type StaffRepository = Readonly<{
  create(
    input: StaffProvisioningRepositoryInput,
  ): Promise<
    | Readonly<{ status: "created"; staff: StaffRecord }>
    | Readonly<{ status: "conflict" }>
  >;
  updateProfile(
    tenantContext: TenantContext,
    staffId: string,
    patch: Readonly<{
      displayName?: string;
      email?: string | null;
      phone?: string | null;
    }>,
  ): Promise<"updated" | "not_found" | "conflict">;
  setStatus(
    tenantContext: TenantContext,
    staffId: string,
    status: StaffStatus,
  ): Promise<"updated" | "not_found">;
  list(tenantContext: TenantContext): Promise<ReadonlyArray<StaffListRecord>>;
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
        | "AUTH_BINDING_FAILED"
        | "AUTH_BINDING_ROLLBACK_FAILED"
        | "PERSISTENCE_FAILURE"
        | "COMPENSATION_FAILED"
        | "NOT_FOUND"
        | "CONFLICT";
    }>;

/** Empty = no password (email invite path). Not trimmed: spaces are valid password characters. */
function temporaryPassword(value: unknown): string | null | "INVALID" {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length < 8 || value.length > 128) return "INVALID";
  return value;
}

function optionalText(value: unknown): string | null | "INVALID" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized))
    return normalized ? "INVALID" : null;
  return normalized;
}

export function createStaffManager(
  dependencies: Readonly<{
    authorizer: StaffManagementAuthorizer;
    authProvisioner: AuthAdminProvisioner;
    authBinding: TenantAdminAuthBinding;
    repository: StaffRepository;
  }>,
) {
  return {
    async create(
      input: StaffProvisioningInput,
    ): Promise<StaffManagementResult> {
      if (
        !(await dependencies.authorizer.authorize(
          input.identity,
          input.tenantContext,
          "TENANT_ADMIN",
        ))
      ) {
        return { status: "UNAUTHORIZED" };
      }
      if (
        typeof input.displayName !== "string" ||
        input.displayName.trim() === ""
      ) {
        return { status: "INVALID_INPUT" };
      }
      const email = optionalText(input.email);
      const phone = optionalText(input.phone);
      if (email === "INVALID" || phone === "INVALID")
        return { status: "INVALID_INPUT" };
      const password = temporaryPassword(input.password);
      // A login password only makes sense with a login email.
      if (password === "INVALID" || (password !== null && email === null))
        return { status: "INVALID_INPUT" };

      const auth = await dependencies.authProvisioner.provision({
        email,
        displayName: input.displayName.trim(),
        tenantId: input.tenantContext.tenantId,
        ...(password !== null ? { password } : {}),
      });
      if (auth.status === "failed")
        return { status: "AUTH_PROVISIONING_FAILED" };

      const binding = await dependencies.authBinding.bindTenant(
        auth.subjectId,
        input.tenantContext.tenantId,
      );
      if (binding.status === "failed") {
        const compensation = await dependencies.authProvisioner.compensate(
          auth.subjectId,
        );
        return compensation.status === "failed"
          ? { status: "COMPENSATION_FAILED" }
          : { status: "AUTH_BINDING_FAILED" };
      }

      const persisted = await dependencies.repository.create({
        tenantId: input.tenantContext.tenantId,
        subjectId: auth.subjectId,
        displayName: input.displayName.trim(),
        email,
        phone,
      });
      if (persisted.status === "created") return persisted;

      if (binding.status === "bound") {
        const rollback = await dependencies.authBinding.rollbackTenantBinding(
          auth.subjectId,
          input.tenantContext.tenantId,
        );
        if (rollback.status === "failed")
          return { status: "AUTH_BINDING_ROLLBACK_FAILED" };
      }

      const compensation = await dependencies.authProvisioner.compensate(
        auth.subjectId,
      );
      if (compensation.status === "failed")
        return { status: "COMPENSATION_FAILED" };
      return { status: "CONFLICT" };
    },

    async setStatus(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      staffId: string,
      status: unknown,
    ): Promise<StaffManagementResult> {
      if (
        !(await dependencies.authorizer.authorize(
          identity,
          tenantContext,
          "TENANT_ADMIN",
        ))
      ) {
        return { status: "UNAUTHORIZED" };
      }
      let nextStatus: StaffStatus;
      try {
        nextStatus = createStaffStatus(status);
      } catch {
        return { status: "INVALID_INPUT" };
      }
      const result = await dependencies.repository.setStatus(
        tenantContext,
        staffId,
        nextStatus,
      );
      return result === "updated"
        ? { status: "updated" }
        : { status: "NOT_FOUND" };
    },

    async updateProfile(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      staffId: string,
      patch: Readonly<{
        displayName?: unknown;
        email?: unknown;
        phone?: unknown;
      }>,
    ): Promise<
      Readonly<{
        status:
          | "updated"
          | "UNAUTHORIZED"
          | "INVALID_INPUT"
          | "NOT_FOUND"
          | "CONFLICT";
      }>
    > {
      if (
        !(await dependencies.authorizer.authorize(
          identity,
          tenantContext,
          "TENANT_ADMIN",
        ))
      )
        return { status: "UNAUTHORIZED" };
      const normalized: {
        displayName?: string;
        email?: string | null;
        phone?: string | null;
      } = {};
      if ("displayName" in patch) {
        if (
          typeof patch.displayName !== "string" ||
          patch.displayName.trim() === ""
        )
          return { status: "INVALID_INPUT" };
        normalized.displayName = patch.displayName.trim();
      }
      for (const key of ["email", "phone"] as const) {
        if (key in patch) {
          const value = optionalText(patch[key]);
          if (value === "INVALID") return { status: "INVALID_INPUT" };
          normalized[key] = value;
        }
      }
      const result = await dependencies.repository.updateProfile(
        tenantContext,
        staffId,
        normalized,
      );
      if (result === "updated") return { status: "updated" };
      if (result === "not_found") return { status: "NOT_FOUND" };
      return { status: "CONFLICT" };
    },

    async list(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
    ): Promise<
      Readonly<{
        status: "listed" | "UNAUTHORIZED" | "PERSISTENCE_FAILURE";
        staff?: ReadonlyArray<StaffListRecord>;
      }>
    > {
      if (
        !(await dependencies.authorizer.authorize(
          identity,
          tenantContext,
          "TENANT_ADMIN",
        ))
      )
        return { status: "UNAUTHORIZED" };
      try {
        return {
          status: "listed",
          staff: await dependencies.repository.list(tenantContext),
        };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}

/**
 * Owner decision 2026-11-05: a TENANT_ADMIN may also serve customers as a bookable staff member.
 * Acts ONLY on the caller's own membership profile in the trusted tenant; no client-supplied ids,
 * no new auth user and no membership change. Enabling creates or reactivates the caller's Staff row;
 * disabling sets it INACTIVE (never deletes it, so past appointments keep their staff).
 */
export type AdminSelfStaffMembershipReader = Readonly<{
  /** Membership of the authenticated identity in the trusted tenant, read server-side. */
  readOwnMembership(
    identity: Extract<ApplicationIdentity, { state: "authenticated" }>,
    tenantContext: TenantContext,
  ): Promise<Readonly<{ role: TenantRole; profileId: string }> | null>;
}>;

export type AdminSelfStaffRepository = Readonly<{
  findOwnStatus(tenantContext: TenantContext, profileId: string): Promise<StaffStatus | null>;
  /** ACTIVE: create the row for this profile or reactivate it. INACTIVE: deactivate an existing row only. */
  setOwnStatus(tenantContext: TenantContext, profileId: string, status: StaffStatus): Promise<"updated" | "not_found">;
}>;

export type AdminServesAsStaffResult =
  | Readonly<{ status: "ok"; servesAsStaff: boolean }>
  | Readonly<{ status: "UNAUTHORIZED" | "INVALID_INPUT" | "PERSISTENCE_FAILURE" }>;

export function createAdminServesAsStaff(
  dependencies: Readonly<{
    membershipReader: AdminSelfStaffMembershipReader;
    repository: AdminSelfStaffRepository;
  }>,
) {
  /** Exact TENANT_ADMIN only (not SUPER_ADMIN), and the profile must be the session's own. */
  async function ownAdminProfileId(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<string | null> {
    if (identity.state !== "authenticated") return null;
    const membership = await dependencies.membershipReader.readOwnMembership(identity, tenantContext);
    if (!membership || membership.role !== "TENANT_ADMIN") return null;
    if (membership.profileId !== identity.profileId) return null;
    return membership.profileId;
  }

  return {
    async read(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<AdminServesAsStaffResult> {
      try {
        const profileId = await ownAdminProfileId(identity, tenantContext);
        if (!profileId) return { status: "UNAUTHORIZED" };
        const status = await dependencies.repository.findOwnStatus(tenantContext, profileId);
        return { status: "ok", servesAsStaff: status === "ACTIVE" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async set(identity: ApplicationIdentity, tenantContext: TenantContext, enabled: unknown): Promise<AdminServesAsStaffResult> {
      if (typeof enabled !== "boolean") return { status: "INVALID_INPUT" };
      try {
        const profileId = await ownAdminProfileId(identity, tenantContext);
        if (!profileId) return { status: "UNAUTHORIZED" };
        // Disabling without a row is already the desired state.
        await dependencies.repository.setOwnStatus(tenantContext, profileId, enabled ? "ACTIVE" : "INACTIVE");
        return { status: "ok", servesAsStaff: enabled };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
