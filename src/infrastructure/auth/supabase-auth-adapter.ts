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

function readAppMetadataValue(appMetadata: unknown, key: string): unknown {
  if (typeof appMetadata !== "object" || appMetadata === null) return undefined;
  if (!(key in appMetadata)) return undefined;
  return appMetadata[key as keyof typeof appMetadata];
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

        const appMetadata = response.data.user.app_metadata;
        const tenantId = readAppMetadataValue(appMetadata, "tenant_id");
        const platformRole = readAppMetadataValue(appMetadata, "platform_role");

        return {
          state: "authenticated",
          subjectId,
          ...(tenantId === undefined ? {} : { tenantId }),
          ...(platformRole === undefined ? {} : { platformRole }),
        };
      } catch {
        return { state: "unauthenticated" };
      }
    },
  };
}
