import type { AuthSubjectId } from "../domain/auth-identity";

export type AuthProvisioningInput = Readonly<{
  email?: string | null;
  password?: string | null;
  displayName: string;
  tenantId: string;
}>;

export type AuthProvisioningFailure =
  | "INVALID_CONFIGURATION"
  | "INVALID_INPUT"
  | "PROVIDER_REJECTED"
  | "ALREADY_EXISTS"
  | "NETWORK_FAILURE";

export type AuthProvisioningResult =
  | Readonly<{ status: "created"; subjectId: AuthSubjectId }>
  | Readonly<{ status: "failed"; reason: AuthProvisioningFailure }>;

export interface AuthAdminProvisioner {
  provision(input: AuthProvisioningInput): Promise<AuthProvisioningResult>;
  compensate(subjectId: AuthSubjectId): Promise<Readonly<{ status: "compensated" | "failed" }>>;
}
