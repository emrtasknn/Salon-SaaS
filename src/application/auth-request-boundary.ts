import type { ApplicationIdentity } from "../domain/auth-identity";
import {
  createAuthenticatedIdentity,
  createUnauthenticatedIdentity,
} from "../domain/auth-identity";

export type ServerAuthSnapshot =
  | Readonly<{
      state: "authenticated";
      subjectId: unknown;
      profileId: unknown;
    }>
  | Readonly<{
      state: "unauthenticated";
    }>;

export interface ServerAuthAdapter {
  readIdentity(): Promise<ServerAuthSnapshot>;
}

export async function readApplicationIdentity(
  adapter: ServerAuthAdapter,
): Promise<ApplicationIdentity> {
  try {
    const snapshot = await adapter.readIdentity();

    if (snapshot.state === "unauthenticated") {
      return createUnauthenticatedIdentity();
    }

    if (
      snapshot.state !== "authenticated" ||
      typeof snapshot.subjectId !== "string" ||
      typeof snapshot.profileId !== "string"
    ) {
      return createUnauthenticatedIdentity();
    }

    try {
      return createAuthenticatedIdentity(
        snapshot.subjectId,
        snapshot.profileId,
      );
    } catch {
      return createUnauthenticatedIdentity();
    }
  } catch {
    return createUnauthenticatedIdentity();
  }
}
