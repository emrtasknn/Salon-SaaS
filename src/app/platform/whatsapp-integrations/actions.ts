"use server";

import { readAuthenticatedPlatformRequest } from "@/application/auth-request-boundary";
import { createNextSupabaseServerClient } from "@/infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "@/infrastructure/auth/supabase-server-env";
import { createSupabaseAuthAdapter } from "@/infrastructure/auth/supabase-auth-adapter";

export type ProvisionWhatsAppIntegrationActionInput = Readonly<{
  phoneNumberId: string;
}>;
function isValidPhoneNumberId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}



export type ProvisionWhatsAppIntegrationActionResult =
  | Readonly<{ status: "DISABLED" }>
  | Readonly<{ status: "UNAUTHORIZED" }>
  | Readonly<{ status: "INVALID_INPUT" }>
  | Readonly<{ status: "TENANT_RESOLUTION_UNAVAILABLE" }>;

/**
 * Server-side entry point for WhatsAppIntegration provisioning.
 *
 * Security posture:
 * - Authenticated platform (SUPER_ADMIN) identity is established server-side
 *   via readAuthenticatedPlatformRequest; client input is never trusted for
 *   authorization.
 * - The operation is gated by the WHATSAPP_INTEGRATION_PROVISIONING_ENABLED
 *   environment flag and is disabled by default (missing or non-"true" value).
 * - Trusted tenant resolution for a platform-scoped provisioning target is not
 *   available in the current architecture (no trusted route-derived slug or
 *   server-side tenant resolver exists for SUPER_ADMIN). The action therefore
 *   fails closed instead of accepting a client-provided tenant identifier.
 */
export async function provisionWhatsAppIntegrationAction(
  input: ProvisionWhatsAppIntegrationActionInput,
): Promise<ProvisionWhatsAppIntegrationActionResult> {
  // Environment gate: disabled by default. Only an explicit "true" enables it.
  if (process.env.WHATSAPP_INTEGRATION_PROVISIONING_ENABLED !== "true") {
    return { status: "DISABLED" as const };
  }

  const supabase = await createNextSupabaseServerClient(
    readSupabaseServerClientConfig(),
  );
  const context = await readAuthenticatedPlatformRequest(
    createSupabaseAuthAdapter({ client: supabase as never }),
  );

  if (context.state !== "authenticated") {
    return { status: "UNAUTHORIZED" as const };
  }

  // Server-side validation of phoneNumberId.
  if (!isValidPhoneNumberId(input?.phoneNumberId)) {
    return { status: "INVALID_INPUT" as const };
  }

  // Trusted tenant resolution is unavailable for platform-scoped provisioning.
  // We must not fall back to a client-provided tenant identifier here.
  return { status: "TENANT_RESOLUTION_UNAVAILABLE" as const };
}
