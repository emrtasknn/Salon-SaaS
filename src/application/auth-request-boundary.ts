import type {
  AuthenticatedSubjectIdentity,
  UnauthenticatedIdentity,
} from "../domain/auth-identity";
import {
  createAuthenticatedSubjectIdentity,
  createUnauthenticatedIdentity,
} from "../domain/auth-identity";
import {
  createTenantContext,
  type TenantContext,
} from "../domain/tenant-context";

export type ServerAuthSnapshot =
  | Readonly<{
      state: "authenticated";
      subjectId: unknown;
      tenantId?: unknown;
    }>
  | Readonly<{
      state: "unauthenticated";
    }>;

export interface ServerAuthAdapter {
  readIdentity(): Promise<ServerAuthSnapshot>;
}

export async function readAuthenticatedSubject(
  adapter: ServerAuthAdapter,
): Promise<AuthenticatedSubjectIdentity | UnauthenticatedIdentity> {
  try {
    const snapshot = await adapter.readIdentity();

    if (snapshot.state === "unauthenticated") {
      return createUnauthenticatedIdentity();
    }

    if (
      snapshot.state !== "authenticated" ||
      typeof snapshot.subjectId !== "string"
    ) {
      return createUnauthenticatedIdentity();
    }

    try {
      return createAuthenticatedSubjectIdentity(snapshot.subjectId);
    } catch {
      return createUnauthenticatedIdentity();
    }
  } catch {
    return createUnauthenticatedIdentity();
  }
}

export type AuthenticatedTenantRequest =
  | Readonly<{
      state: "authenticated";
      identity: AuthenticatedSubjectIdentity;
      tenantContext: TenantContext;
    }>
  | Readonly<{ state: "unauthenticated" }>;

export async function readAuthenticatedTenantRequest(
  adapter: ServerAuthAdapter,
): Promise<AuthenticatedTenantRequest> {
  try {
    const snapshot = await adapter.readIdentity();

    if (
      snapshot.state !== "authenticated" ||
      typeof snapshot.subjectId !== "string"
    ) {
      return createUnauthenticatedIdentity();
    }

    const identity = createAuthenticatedSubjectIdentity(snapshot.subjectId);
    const tenantContextResult = createTenantContext({
      tenantId: snapshot.tenantId,
    });

    if (!tenantContextResult.ok) {
      return createUnauthenticatedIdentity();
    }

    return Object.freeze({
      state: "authenticated",
      identity,
      tenantContext: tenantContextResult.value,
    });
  } catch {
    return createUnauthenticatedIdentity();
  }
}
