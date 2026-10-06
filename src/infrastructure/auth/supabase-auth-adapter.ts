import type {
  ServerAuthAdapter,
  ServerAuthSnapshot,
} from "../../application/auth-request-boundary";

export type SupabaseAuthUser = Readonly<{
  id: unknown;
  app_metadata?: unknown;
}>;

export type SupabaseAuthResponse = Readonly<{
  data: Readonly<{ user: SupabaseAuthUser | null }>;
  error: unknown;
}>;

export interface SupabaseAuthClient {
  auth: { getUser(): Promise<SupabaseAuthResponse> };
}

export type SupabaseAuthAdapterDependencies = Readonly<{
  client: SupabaseAuthClient;
}>;

function readTenantId(appMetadata: unknown): unknown {
  if (typeof appMetadata !== "object" || appMetadata === null) {
    return undefined;
  }

  if (!("tenant_id" in appMetadata)) {
    return undefined;
  }

  return appMetadata.tenant_id;
}

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

        return {
          state: "authenticated",
          subjectId,
          tenantId: readTenantId(response.data.user.app_metadata),
        };
      } catch {
        return { state: "unauthenticated" };
      }
    },
  };
}
