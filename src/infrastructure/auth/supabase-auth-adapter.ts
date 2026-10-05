import type { ServerAuthAdapter, ServerAuthSnapshot } from "../../application/auth-request-boundary";

export type SupabaseAuthUser = Readonly<{ id: unknown }>;

export type SupabaseAuthResponse = Readonly<{
  data: Readonly<{ user: SupabaseAuthUser | null }>;
  error: unknown;
}>;

export interface SupabaseAuthClient {
  auth: { getUser(): Promise<SupabaseAuthResponse> };
}

export type SupabaseProfileIdResolver = (subjectId: string) => Promise<unknown>;

export type SupabaseAuthAdapterDependencies = Readonly<{
  client: SupabaseAuthClient;
  resolveProfileId: SupabaseProfileIdResolver;
}>;

export function createSupabaseAuthAdapter(
  dependencies: SupabaseAuthAdapterDependencies,
): ServerAuthAdapter {
  return {
    async readIdentity(): Promise<ServerAuthSnapshot> {
      try {
        const response = await dependencies.client.auth.getUser();

        if (response.error !== null || response.data.user === null) {
          return { state: "unauthenticated" };
        }

        const subjectId = response.data.user.id;
        if (typeof subjectId !== "string" || subjectId.length === 0) {
          return { state: "unauthenticated" };
        }

        const profileId = await dependencies.resolveProfileId(subjectId);
        return { state: "authenticated", subjectId, profileId };
      } catch {
        return { state: "unauthenticated" };
      }
    },
  };
}
