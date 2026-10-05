import type {
  AuthenticatedSubjectIdentity,
  ApplicationIdentity,
} from "../domain/auth-identity";
import {
  createAuthenticatedSubjectIdentity,
  createUnauthenticatedIdentity,
} from "../domain/auth-identity";

export type ServerAuthSnapshot =
  | Readonly<{
      state: "authenticated";
      subjectId: unknown;
    }>
  | Readonly<{
      state: "unauthenticated";
    }>;

export interface ServerAuthAdapter {
  readIdentity(): Promise<ServerAuthSnapshot>;
}

export async function readAuthenticatedSubject(
  adapter: ServerAuthAdapter,
): Promise<AuthenticatedSubjectIdentity | ReturnType<typeof createUnauthenticatedIdentity>> {
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

/**
 * @deprecated Authentication must establish subject only. Use readAuthenticatedSubject()
 * followed by tenant-aware identity enrichment.
 */
export async function readApplicationIdentity(
  adapter: ServerAuthAdapter,
): Promise<ApplicationIdentity> {
  const identity = await readAuthenticatedSubject(adapter);
  return identity.state === "unauthenticated"
    ? identity
    : createUnauthenticatedIdentity();
}
