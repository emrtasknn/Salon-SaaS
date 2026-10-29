import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/auth/supabase-server-client", () => ({
  createNextSupabaseServerClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/infrastructure/auth/supabase-server-env", () => ({
  readSupabaseServerClientConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("@/infrastructure/auth/supabase-auth-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn().mockReturnValue({ readIdentity: vi.fn() }),
}));

vi.mock("@/application/auth-request-boundary", () => ({
  readAuthenticatedPlatformRequest: vi.fn(),
}));

import { readAuthenticatedPlatformRequest } from "@/application/auth-request-boundary";
import { provisionWhatsAppIntegrationAction } from "./actions";

describe("provisionWhatsAppIntegrationAction", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is disabled by default when the env flag is missing", async () => {
    delete process.env.WHATSAPP_INTEGRATION_PROVISIONING_ENABLED;
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "1234567890",
    });
    expect(result).toEqual({ status: "DISABLED" });
    expect(readAuthenticatedPlatformRequest).not.toHaveBeenCalled();
  });

  it("is disabled when the env flag is false", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "false");
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "1234567890",
    });
    expect(result).toEqual({ status: "DISABLED" });
    expect(readAuthenticatedPlatformRequest).not.toHaveBeenCalled();
  });

  it("is disabled when the env flag is an arbitrary value", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "yes");
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "1234567890",
    });
    expect(result).toEqual({ status: "DISABLED" });
  });

  it("returns UNAUTHORIZED when the platform request is not authenticated", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "true");
    vi.mocked(readAuthenticatedPlatformRequest).mockResolvedValue({
      state: "unauthenticated",
    } as never);
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "1234567890",
    });
    expect(result).toEqual({ status: "UNAUTHORIZED" });
  });

  it("returns INVALID_INPUT when phoneNumberId is invalid", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "true");
    vi.mocked(readAuthenticatedPlatformRequest).mockResolvedValue({
      state: "authenticated",
      identity: { state: "authenticated", subjectId: "super-admin-subject" },
      platformRole: "SUPER_ADMIN",
    } as never);
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "   ",
    });
    expect(result).toEqual({ status: "INVALID_INPUT" });
  });

  it("fails closed on tenant resolution when authenticated as SUPER_ADMIN", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_PROVISIONING_ENABLED", "true");
    vi.mocked(readAuthenticatedPlatformRequest).mockResolvedValue({
      state: "authenticated",
      identity: { state: "authenticated", subjectId: "super-admin-subject" },
      platformRole: "SUPER_ADMIN",
    } as never);
    const result = await provisionWhatsAppIntegrationAction({
      phoneNumberId: "1234567890",
    });
    expect(result).toEqual({ status: "TENANT_RESOLUTION_UNAVAILABLE" });
  });
});
