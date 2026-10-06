import type { AuthSubjectId } from "../domain/auth-identity";

export type TenantAdminAuthBindingResult =
  | Readonly<{ status: "bound" }>
  | Readonly<{ status: "already_bound" }>
  | Readonly<{
      status: "failed";
      reason: "INVALID_CONFIGURATION" | "INVALID_INPUT" | "CONFLICT" | "PROVIDER_REJECTED" | "NETWORK_FAILURE";
    }>;

export interface TenantAdminAuthBinding {
  bindTenant(
    subjectId: AuthSubjectId,
    tenantId: string,
  ): Promise<TenantAdminAuthBindingResult>;
  rollbackTenantBinding(
    subjectId: AuthSubjectId,
    tenantId: string,
  ): Promise<Readonly<{ status: "rolled_back" | "not_owned" | "failed" }>>;
}
