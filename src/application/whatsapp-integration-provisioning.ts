import type { TenantContext } from "../domain/tenant-context";

export type WhatsAppIntegrationProvider = "META_WHATSAPP";

export type WhatsAppIntegrationProvisioningActor = Readonly<{
  kind: "SUPER_ADMIN";
  subjectId: string;
}>;

export type WhatsAppIntegrationProvisioningInput = Readonly<{
  actor: WhatsAppIntegrationProvisioningActor;
  tenantContext: TenantContext;
  provider: WhatsAppIntegrationProvider;
  phoneNumberId: string;
}>;

export type WhatsAppIntegrationProvisioningResult =
  | Readonly<{ status: "created" }>
  | Readonly<{
      status:
        | "UNAUTHORIZED"
        | "INVALID_INPUT"
        | "DUPLICATE_PHONE_NUMBER_ID"
        | "PERSISTENCE_FAILURE";
    }>;

export interface WhatsAppIntegrationProvisioningAuthorizer {
  authorize(
    actor: WhatsAppIntegrationProvisioningActor,
  ): Promise<Readonly<{ allowed: true } | { allowed: false }>>;
}

export interface WhatsAppIntegrationProvisioningRepository {
  create(
    input: Readonly<{
      tenantId: string;
      provider: string;
      phoneNumberId: string;
    }>,
  ): Promise<
    Readonly<{ status: "created" } | { status: "duplicate" } | { status: "persistence_failure" }>
  >;
}

function isValidPhoneNumberId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function createWhatsAppIntegrationProvisioner(
  dependencies: Readonly<{
    authorizer: WhatsAppIntegrationProvisioningAuthorizer;
    repository: WhatsAppIntegrationProvisioningRepository;
  }>,
) {
  return {
    async provision(
      input: WhatsAppIntegrationProvisioningInput,
    ): Promise<WhatsAppIntegrationProvisioningResult> {
      const authorization = await dependencies.authorizer.authorize(input.actor);
      if (!authorization.allowed) {
        return { status: "UNAUTHORIZED" as const };
      }

      if (input.provider !== "META_WHATSAPP") {
        return { status: "INVALID_INPUT" as const };
      }

      if (!isValidPhoneNumberId(input.phoneNumberId)) {
        return { status: "INVALID_INPUT" as const };
      }

      const result = await dependencies.repository.create({
        tenantId: input.tenantContext.tenantId,
        provider: input.provider,
        phoneNumberId: input.phoneNumberId,
      });

      if (result.status === "created") return { status: "created" as const };
      if (result.status === "duplicate")
        return { status: "DUPLICATE_PHONE_NUMBER_ID" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },
  };
}
