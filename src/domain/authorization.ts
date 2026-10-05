import type {
  ApplicationIdentity,
  AuthSubjectId,
} from "./auth-identity";
import type { TenantContext, TenantId } from "./tenant-context";

export type TenantRole =
  | "SUPER_ADMIN"
  | "TENANT_ADMIN"
  | "STAFF"
  | "CUSTOMER";

export type AuthorizationMembership = Readonly<{
  tenantId: TenantId;
  subjectId: AuthSubjectId;
  profileId: string;
  role: TenantRole;
}>;

export type AuthorizationRequest = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  membership: AuthorizationMembership | null;
  requiredRole: TenantRole;
}>;

export type AuthorizationResult =
  | Readonly<{ status: "allowed"; role: TenantRole }>
  | Readonly<{
      status: "denied";
      reason:
        | "UNAUTHENTICATED"
        | "MISSING_MEMBERSHIP"
        | "TENANT_MISMATCH"
        | "IDENTITY_MISMATCH"
        | "INSUFFICIENT_ROLE"
        | "INVALID_REQUEST";
    }>;

const ROLE_LEVEL: Readonly<Record<TenantRole, number>> = Object.freeze({
  CUSTOMER: 10,
  STAFF: 20,
  TENANT_ADMIN: 30,
  SUPER_ADMIN: 40,
});

function isTenantRole(value: unknown): value is TenantRole {
  return (
    value === "SUPER_ADMIN" ||
    value === "TENANT_ADMIN" ||
    value === "STAFF" ||
    value === "CUSTOMER"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApplicationIdentity(value: unknown): value is ApplicationIdentity {
  if (!isRecord(value) || typeof value.state !== "string") {
    return false;
  }

  if (value.state === "unauthenticated") {
    return true;
  }

  return (
    value.state === "authenticated" &&
    typeof value.subjectId === "string" &&
    typeof value.profileId === "string" &&
    value.profileId.length > 0
  );
}

function isTenantContext(value: unknown): value is TenantContext {
  return (
    isRecord(value) &&
    typeof value.tenantId === "string" &&
    value.tenantId.length > 0
  );
}

function isMembership(value: unknown): value is AuthorizationMembership {
  return (
    isRecord(value) &&
    typeof value.tenantId === "string" &&
    value.tenantId.length > 0 &&
    typeof value.subjectId === "string" &&
    value.subjectId.length > 0 &&
    typeof value.profileId === "string" &&
    value.profileId.length > 0 &&
    isTenantRole(value.role)
  );
}

function isAuthorizationRequest(
  value: unknown,
): value is AuthorizationRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isApplicationIdentity(value.identity) &&
    isTenantContext(value.tenantContext) &&
    (value.membership === null || isMembership(value.membership)) &&
    isTenantRole(value.requiredRole)
  );
}

export function authorize(
  request: unknown,
): AuthorizationResult {
  if (!isAuthorizationRequest(request)) {
    return { status: "denied", reason: "INVALID_REQUEST" };
  }

  if (request.identity.state === "unauthenticated") {
    return { status: "denied", reason: "UNAUTHENTICATED" };
  }

  if (request.membership === null) {
    return { status: "denied", reason: "MISSING_MEMBERSHIP" };
  }

  if (request.membership.tenantId !== request.tenantContext.tenantId) {
    return { status: "denied", reason: "TENANT_MISMATCH" };
  }

  if (
    request.membership.subjectId !== request.identity.subjectId ||
    request.membership.profileId !== request.identity.profileId
  ) {
    return { status: "denied", reason: "IDENTITY_MISMATCH" };
  }

  if (
    ROLE_LEVEL[request.membership.role] <
    ROLE_LEVEL[request.requiredRole]
  ) {
    return { status: "denied", reason: "INSUFFICIENT_ROLE" };
  }

  return { status: "allowed", role: request.membership.role };
}
