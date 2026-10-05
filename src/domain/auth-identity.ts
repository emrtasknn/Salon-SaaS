export type AuthSubjectId = string & { readonly __brand: "AuthSubjectId" };

export type AuthenticatedIdentity = Readonly<{
  state: "authenticated";
  subjectId: AuthSubjectId;
  profileId: string;
}>;

export type UnauthenticatedIdentity = Readonly<{
  state: "unauthenticated";
}>;

export type ApplicationIdentity =
  | AuthenticatedIdentity
  | UnauthenticatedIdentity;

export type AuthProfileMapping = Readonly<{
  subjectId: AuthSubjectId;
  profileId: string;
}>;

export function createAuthSubjectId(value: unknown): AuthSubjectId {
  if (typeof value !== "string") {
    throw new TypeError("Auth subject ID must be a string");
  }

  if (value.length === 0 || value.trim() !== value || value.length > 128) {
    throw new TypeError("Auth subject ID is invalid");
  }

  if ([...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new TypeError("Auth subject ID contains control characters");
  }

  return value as AuthSubjectId;
}

export function createUnauthenticatedIdentity(): UnauthenticatedIdentity {
  return Object.freeze({ state: "unauthenticated" });
}

export function createAuthenticatedIdentity(
  subjectId: unknown,
  profileId: unknown,
): AuthenticatedIdentity {
  if (typeof profileId !== "string" || profileId.length === 0 || profileId.trim() !== profileId) {
    throw new TypeError("Profile ID is invalid");
  }

  return Object.freeze({
    state: "authenticated",
    subjectId: createAuthSubjectId(subjectId),
    profileId,
  });
}

export function createAuthProfileMapping(
  subjectId: unknown,
  profileId: unknown,
): AuthProfileMapping {
  const identity = createAuthenticatedIdentity(subjectId, profileId);

  return Object.freeze({
    subjectId: identity.subjectId,
    profileId: identity.profileId,
  });
}
