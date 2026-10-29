import { describe, expect, it, vi } from "vitest";
import {
  createWhatsAppIntegrationProvisioner,
  type WhatsAppIntegrationProvisioningActor,
  type WhatsAppIntegrationProvisioningInput,
  type WhatsAppIntegrationProvider,
} from "./whatsapp-integration-provisioning";

function makeActor(
  subjectId = "trusted-subject",
  kind: string = "SUPER_ADMIN",
): WhatsAppIntegrationProvisioningActor {
  return { kind, subjectId } as WhatsAppIntegrationProvisioningActor;
}

function makeTenantContext(
  tenantId = "tenant-a",
): WhatsAppIntegrationProvisioningInput["tenantContext"] {
  return { tenantId: tenantId as never };
}

function baseInput(): WhatsAppIntegrationProvisioningInput {
  return {
    actor: makeActor(),
    tenantContext: makeTenantContext(),
    provider: "META_WHATSAPP",
    phoneNumberId: "123",
  };
}

function validInput(
  overrides: Readonly<{
    provider?: WhatsAppIntegrationProvider;
    phoneNumberId?: string;
  }> = {},
): WhatsAppIntegrationProvisioningInput {
  return { ...baseInput(), ...overrides };
}

describe("whatsapp integration provisioning", () => {
  it("forwards a valid request from an authorized SUPER_ADMIN to the repository", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue({ allowed: true }) };
    const repository = { create: vi.fn().mockResolvedValue({ status: "created" }) };
    const input = validInput();

    const result = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository,
    }).provision(input);

    expect(result).toEqual({ status: "created" });
    expect(authorizer.authorize).toHaveBeenCalledOnce();
    expect(repository.create).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      provider: "META_WHATSAPP",
      phoneNumberId: "123",
    });
  });

  it("rejects actors that are not SUPER_ADMIN", async () => {
    const authorizer = {
      authorize: vi.fn().mockImplementation((actor) =>
        Promise.resolve({ allowed: actor.kind === "SUPER_ADMIN" }),
      ),
    };
    const repository = { create: vi.fn() };
    const result = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository,
    }).provision({
      ...baseInput(),
      actor: makeActor("subject-a", "TENANT_ADMIN"),
    });

    expect(result).toEqual({ status: "UNAUTHORIZED" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects when actor subject does not match trusted request context", async () => {
    const authorizer = {
      authorize: vi.fn().mockImplementation((actor) =>
        Promise.resolve({ allowed: actor.subjectId === "trusted-subject" }),
      ),
    };
    const repository = { create: vi.fn() };
    const result = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository,
    }).provision({
      ...baseInput(),
      actor: makeActor("wrong-subject"),
    });

    expect(result).toEqual({ status: "UNAUTHORIZED" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects invalid or empty phoneNumberId", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue({ allowed: true }) };
    const repository = { create: vi.fn() };
    for (const phoneNumberId of [undefined, "", "  ", " 123 ", "\u0000bad"]) {
      const result = await createWhatsAppIntegrationProvisioner({
        authorizer,
        repository,
      }).provision(validInput({ phoneNumberId: phoneNumberId as never }));

      expect(result).toEqual({ status: "INVALID_INPUT" });
      expect(repository.create).not.toHaveBeenCalled();
    }
  });

  it("rejects provider values other than META_WHATSAPP", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue({ allowed: true }) };
    const repository = { create: vi.fn() };
    const result = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository,
    }).provision(validInput({ provider: "OTHER" as never }));

    expect(result).toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("does not call the repository for unauthorized or invalid requests", async () => {
    const repository = { create: vi.fn() };

    const unauthorized = createWhatsAppIntegrationProvisioner({
      authorizer: { authorize: vi.fn().mockResolvedValue({ allowed: false }) },
      repository,
    });
    await unauthorized.provision(validInput());
    expect(repository.create).not.toHaveBeenCalled();

    const invalid = createWhatsAppIntegrationProvisioner({
      authorizer: { authorize: vi.fn().mockResolvedValue({ allowed: true }) },
      repository,
    });
    await invalid.provision(validInput({ phoneNumberId: "" as never }));
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("maps repository errors to the application error model", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue({ allowed: true }) };
    const repository = { create: vi.fn().mockResolvedValue({ status: "duplicate" }) };
    const result = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository,
    }).provision(validInput());
    expect(result).toEqual({ status: "DUPLICATE_PHONE_NUMBER_ID" });
    expect(repository.create).toHaveBeenCalledOnce();

    const failureRepository = {
      create: vi.fn().mockResolvedValue({ status: "persistence_failure" }),
    };
    const failureResult = await createWhatsAppIntegrationProvisioner({
      authorizer,
      repository: failureRepository,
    }).provision(validInput());
    expect(failureResult).toEqual({ status: "PERSISTENCE_FAILURE" });
  });
});
