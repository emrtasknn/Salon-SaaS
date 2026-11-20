import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { isRecordId, type DeleteResult } from "../domain/deletion";

export type CustomerDeletionRepository = Readonly<{
  erase(tenantContext: TenantContext, input: Readonly<{ profileId: string; now: Date }>): Promise<
    | "erased" | "not_found" | "not_customer"
    | { status: "has_active_appointments"; count: number }
  >;
  deleteNote(tenantContext: TenantContext, noteId: string): Promise<"deleted" | "not_found">;
}>;

export function createCustomerDeletion(deps: Readonly<{
  repository: CustomerDeletionRepository;
  authorizer: { authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean> };
  now?: () => Date;
}>) {
  return {
    async deleteCustomer(identity: ApplicationIdentity, tenantContext: TenantContext, customerProfileId: unknown): Promise<DeleteResult> {
      if (identity.state !== "authenticated") return { status: "FORBIDDEN" };
      try {
        if (!(await deps.authorizer.authorizeAdmin(identity, tenantContext))) return { status: "FORBIDDEN" };
        if (!isRecordId(customerProfileId)) return { status: "INVALID_INPUT" };
        const result = await deps.repository.erase(tenantContext, {
          profileId: customerProfileId, now: deps.now?.() ?? new Date(),
        });
        if (result === "erased") return { status: "DELETED" };
        if (result === "not_found") return { status: "NOT_FOUND" };
        if (result === "not_customer") return { status: "NOT_DELETABLE" };
        return { status: "HAS_ACTIVE_APPOINTMENTS", count: result.count };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async deleteNote(identity: ApplicationIdentity, tenantContext: TenantContext, noteId: unknown): Promise<DeleteResult> {
      if (identity.state !== "authenticated") return { status: "FORBIDDEN" };
      try {
        if (!(await deps.authorizer.authorizeAdmin(identity, tenantContext))) return { status: "FORBIDDEN" };
        if (!isRecordId(noteId)) return { status: "INVALID_INPUT" };
        const result = await deps.repository.deleteNote(tenantContext, noteId);
        return result === "deleted" ? { status: "DELETED" } : { status: "NOT_FOUND" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
