import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { isRecordId, type DeleteResult } from "../domain/deletion";

export type StaffDeletionRepository = Readonly<{
  archive(tenantContext: TenantContext, input: Readonly<{ staffId: string; actorProfileId: string; now: Date }>): Promise<
    | "archived" | "not_found" | "is_self" | "not_staff_role"
    | { status: "has_active_appointments"; count: number }
  >;
}>;

export function createStaffDeletion(deps: Readonly<{
  repository: StaffDeletionRepository;
  authorizer: { authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean> };
  now?: () => Date;
}>) {
  return {
    async delete(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: unknown): Promise<DeleteResult> {
      if (identity.state !== "authenticated") return { status: "FORBIDDEN" };
      try {
        if (!(await deps.authorizer.authorizeAdmin(identity, tenantContext))) return { status: "FORBIDDEN" };
        if (!isRecordId(staffId)) return { status: "INVALID_INPUT" };
        const result = await deps.repository.archive(tenantContext, {
          staffId, actorProfileId: identity.profileId, now: deps.now?.() ?? new Date(),
        });
        if (result === "archived") return { status: "DELETED" };
        if (result === "not_found") return { status: "NOT_FOUND" };
        if (result === "is_self" || result === "not_staff_role") return { status: "NOT_DELETABLE" };
        return { status: "HAS_ACTIVE_APPOINTMENTS", count: result.count };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
