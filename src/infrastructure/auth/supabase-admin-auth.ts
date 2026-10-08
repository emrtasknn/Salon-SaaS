import "server-only";
import { createAuthSubjectId } from "../../domain/auth-identity";
import type { AuthAdminProvisioner } from "../../application/auth-admin-provisioning";
export type { AuthAdminProvisioner } from "../../application/auth-admin-provisioning";
export type { AuthProvisioningInput } from "../../application/auth-admin-provisioning";
export type SupabaseAdminAuthConfig = Readonly<{
  url: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
}>;

function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const email = value.trim();
  if (email.length > 320 || /[\u0000-\u001f\u007f]/.test(email)) return null;
  return email;
}

function endpoint(config: SupabaseAdminAuthConfig, path: string): string {
  return `${config.url.replace(/\/$/, "")}/auth/v1${path}`;
}

function headers(config: SupabaseAdminAuthConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

export function createSupabaseAdminAuthProvisioner(
  config: SupabaseAdminAuthConfig,
): AuthAdminProvisioner {
  const fetcher = config.fetcher ?? fetch;
  return {
    async provision(input) {
      if (!config.url || !config.serviceRoleKey) return { status: "failed", reason: "INVALID_CONFIGURATION" };
      if (typeof input.displayName !== "string" || input.displayName.trim() === "") {
        return { status: "failed", reason: "INVALID_INPUT" };
      }
      if (
        typeof input.tenantId !== "string" ||
        input.tenantId.trim() !== input.tenantId ||
        input.tenantId.length === 0 ||
        input.tenantId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(input.tenantId)
      ) {
        return { status: "failed", reason: "INVALID_INPUT" };
      }
      const email = normalizeEmail(input.email);
      if (input.email != null && input.email !== "" && email === null) {
        return { status: "failed", reason: "INVALID_INPUT" };
      }
      const password = input.password == null ? null : input.password;
      if (password !== null && (typeof password !== "string" || password.length < 8 || password.length > 128)) {
        return { status: "failed", reason: "INVALID_INPUT" };
      }
      const path = password !== null ? "/admin/users" : email ? "/invite" : "/admin/users";
      const appMetadata = { tenant_id: input.tenantId };
      const body =
        password !== null
          ? {
              email,
              password,
              email_confirm: true,
              user_metadata: { display_name: input.displayName.trim() },
              app_metadata: appMetadata,
            }
          : email
            ? {
                email,
                data: { display_name: input.displayName.trim() },
                app_metadata: appMetadata,
              }
            : {
                user_metadata: { display_name: input.displayName.trim() },
                app_metadata: appMetadata,
              };
      try {
        const response = await fetcher(endpoint(config, path), {
          method: "POST",
          headers: headers(config),
          body: JSON.stringify(body),
        });
        if (response.status === 409) return { status: "failed", reason: "ALREADY_EXISTS" };
        if (!response.ok) return { status: "failed", reason: "PROVIDER_REJECTED" };
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" || payload === null ||
          typeof (payload as { id?: unknown }).id !== "string"
        ) return { status: "failed", reason: "PROVIDER_REJECTED" };
        return { status: "created", subjectId: createAuthSubjectId((payload as { id: string }).id) };
      } catch {
        return { status: "failed", reason: "NETWORK_FAILURE" };
      }
    },
    async compensate(subjectId) {
      if (!config.url || !config.serviceRoleKey) return { status: "failed" };
      try {
        const response = await fetcher(
          endpoint(config, `/admin/users/${encodeURIComponent(subjectId)}`),
          { method: "DELETE", headers: headers(config) },
        );
        return response.ok || response.status === 404
          ? { status: "compensated" }
          : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}
