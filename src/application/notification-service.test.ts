import { describe, expect, it, vi, type Mock } from "vitest";
import { createNotificationService, type NotificationRepository } from "./notification-service";
import { NotificationProviderError } from "../domain/notification";
import { createMockWhatsAppProvider } from "../infrastructure/notifications";

describe("notification service", () => {
  it("sends created notifications to staff and customer", async () => {
    const calls: Array<
      Readonly<{
        to: string;
        body: string;
        templateKey: string;
        templateParameters: ReadonlyArray<string>;
      }>
    > = [];
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "s",
          displayName: "Staff",
          phone: "+90555",
          templateKey: "staff",
          body: "pending",
          templateParameters: [],
        },
        {
          profileId: "c",
          displayName: "Customer",
          phone: "+90556",
          templateKey: "customer",
          body: "created",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };
    const result = await createNotificationService({
      repository,
      provider: createMockWhatsAppProvider(calls),
    }).publish({ tenantId: "t" as never }, "a", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([
      { profileId: "s", status: "SENT" },
      { profileId: "c", status: "SENT" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("marks a definite Meta rejection FAILED without classifying it as UNKNOWN", async () => {
    const repository = {
      recipients: vi.fn().mockResolvedValue([{
        profileId: "customer-1",
        displayName: "Customer",
        phone: "+905551112233",
        templateKey: "appointment-confirmed-customer",
        body: "Randevunuz onaylandı.",
        templateParameters: [],
      }]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn(),
    };
    const provider = {
      channel: "WHATSAPP" as const,
      send: vi.fn().mockRejectedValue(
        new NotificationProviderError("WHATSAPP_PROVIDER_HTTP_400", "rejected"),
      ),
    };

    const result = await createNotificationService({ repository, provider }).publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_CONFIRMED",
    );

    expect(result.results).toEqual([{ profileId: "customer-1", status: "FAILED" }]);
    expect(repository.markFailed).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      expect.objectContaining({
        appointmentId: "appointment-1",
        eventType: "APPOINTMENT_CONFIRMED",
        recipientProfileId: "customer-1",
        errorCode: "WHATSAPP_PROVIDER_HTTP_400",
      }),
    );
    expect(repository.markUnknown).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it("does not duplicate an already sent delivery", async () => {
    const provider = { channel: "WHATSAPP" as const, send: vi.fn() };
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "c",
          displayName: "C",
          phone: "+1",
          templateKey: "x",
          body: "x",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("already_sent"),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };
    const result = await createNotificationService({
      repository,
      provider,
    }).publish({ tenantId: "t" as never }, "a", "APPOINTMENT_CONFIRMED");
    expect(result.results).toEqual([{ profileId: "c", status: "SENT" }]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("sends a rejected-appointment notification to the customer", async () => {
    const calls: Array<
      Readonly<{
        to: string;
        body: string;
        templateKey: string;
        templateParameters: ReadonlyArray<string>;
      }>
    > = [];
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "customer-1",
          displayName: "Customer",
          phone: "+905551112233",
          templateKey: "appointment-rejected-customer",
          body: "Randevu talebiniz onaylanmadı.",
          templateParameters: ["Kesim", "21.10.2026 14:00"],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };

    const result = await createNotificationService({
      repository,
      provider: createMockWhatsAppProvider(calls),
    }).publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_REJECTED",
    );

    expect(result.results).toEqual([
      { profileId: "customer-1", status: "SENT" },
    ]);
    expect(repository.recipients).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      "appointment-1",
      "APPOINTMENT_REJECTED",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].templateKey).toBe("appointment-rejected-customer");
    expect(repository.markSent).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      expect.objectContaining({
        appointmentId: "appointment-1",
        eventType: "APPOINTMENT_REJECTED",
        recipientProfileId: "customer-1",
      }),
    );
  });

  it("marks a rejected-appointment delivery unknown when the provider outcome is uncertain", async () => {
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "customer-1",
          displayName: "Customer",
          phone: "+905551112233",
          templateKey: "appointment-rejected-customer",
          body: "Randevu talebiniz onaylanmadı.",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };
    const provider = {
      channel: "WHATSAPP" as const,
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    const result = await createNotificationService({
      repository,
      provider,
    }).publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_REJECTED",
    );

    expect(result.results).toEqual([
      { profileId: "customer-1", status: "UNKNOWN" },
    ]);
    expect(repository.markUnknown).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      expect.objectContaining({
        appointmentId: "appointment-1",
        eventType: "APPOINTMENT_REJECTED",
        recipientProfileId: "customer-1",
        errorCode: "PROVIDER_OUTCOME_UNKNOWN",
      }),
    );
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it("reports a missing recipient phone without calling the provider", async () => {
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "customer-1",
          displayName: "Customer",
          phone: null,
          templateKey: "appointment-rejected-customer",
          body: "Randevu talebiniz onaylanmadı.",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };
    const provider = { channel: "WHATSAPP" as const, send: vi.fn() };

    const result = await createNotificationService({
      repository,
      provider,
    }).publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_REJECTED",
    );

    expect(result.results).toEqual([
      { profileId: "customer-1", status: "FAILED" },
    ]);
    expect(repository.markFailed).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      expect.objectContaining({ errorCode: "RECIPIENT_PHONE_MISSING" }),
    );
    expect(repository.claim).toHaveBeenCalledOnce();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("does not mark a delivery failed when persistence fails after provider acceptance", async () => {
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "customer-1",
          displayName: "Customer",
          phone: "+905551112233",
          templateKey: "appointment-confirmed-customer",
          body: "Randevunuz onaylandı.",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn().mockRejectedValue(new Error("database unavailable")),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };

    const provider = {
      channel: "WHATSAPP" as const,
      send: vi.fn().mockResolvedValue({
        providerMessageId: "wamid.test",
      }),
    };

    const service = createNotificationService({ repository, provider });

    await expect(
      service.publish(
        { tenantId: "tenant-1" as never },
        "appointment-1",
        "APPOINTMENT_CONFIRMED",
      ),
    ).rejects.toThrow("database unavailable");

    expect(provider.send).toHaveBeenCalledOnce();
    expect(repository.markSent).toHaveBeenCalledOnce();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
  it("does not classify an ambiguous provider network error as a definite failure", async () => {
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "customer-1",
          displayName: "Customer",
          phone: "+905551112233",
          templateKey: "appointment-confirmed-customer",
          body: "Randevunuz onaylandı.",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };

    const provider = {
      channel: "WHATSAPP" as const,
      send: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    };

    const service = createNotificationService({
      repository,
      provider,
    });

    const result = await service.publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_CONFIRMED",
    );

    expect(result.results).toEqual([
      { profileId: "customer-1", status: "UNKNOWN" },
    ]);
    expect(repository.markUnknown).toHaveBeenCalledOnce();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("does not send again when a delivery is already unknown", async () => {
    const provider = { channel: "WHATSAPP" as const, send: vi.fn() };
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        {
          profileId: "c",
          displayName: "C",
          phone: "+1",
          templateKey: "x",
          body: "x",
          templateParameters: [],
        },
      ]),
      claim: vi.fn().mockResolvedValue("already_unknown"),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      markUnknown: vi.fn().mockResolvedValue(undefined),
    };
    const result = await createNotificationService({
      repository,
      provider,
    }).publish({ tenantId: "t" as never }, "a", "APPOINTMENT_CONFIRMED");
    expect(result.results).toEqual([{ profileId: "c", status: "UNKNOWN" }]);
    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markUnknown).not.toHaveBeenCalled();
  });

  it("sends a confirmed-appointment notification to the customer", async () => {
    const calls: Array<Readonly<{
      to: string;
      body: string;
      templateKey: string;
      templateParameters: ReadonlyArray<string>;
    }>> = [];
    const repository = {
      recipients: vi.fn().mockResolvedValue([{
        profileId: "customer-1",
        displayName: "Customer",
        phone: "+905550000000",
        templateKey: "appointment-confirmed-customer",
        body: "Randevunuz onaylandı.",
        templateParameters: ["Kesim", "21.10.2026 14:00", "Staff"],
      }]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
      markUnknown: vi.fn(),
    };

    const result = await createNotificationService({
      repository,
      provider: createMockWhatsAppProvider(calls),
    }).publish(
      { tenantId: "tenant-1" as never },
      "appointment-1",
      "APPOINTMENT_CONFIRMED",
    );

    expect(result.results).toEqual([{ profileId: "customer-1", status: "SENT" }]);
    expect(repository.recipients).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      "appointment-1",
      "APPOINTMENT_CONFIRMED",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: "+905550000000",
      templateKey: "appointment-confirmed-customer",
      templateParameters: ["Kesim", "21.10.2026 14:00", "Staff"],
    });
    expect(repository.markSent).toHaveBeenCalledWith(
      { tenantId: "tenant-1" },
      expect.objectContaining({
        appointmentId: "appointment-1",
        eventType: "APPOINTMENT_CONFIRMED",
        recipientProfileId: "customer-1",
      }),
    );
  });

  describe("with tenant admin recipients (WP-02b)", () => {
    const createdRecipients = [
      { profileId: "staff-1", displayName: "Staff", phone: "+905550000001", templateKey: "appointment-created-staff", body: "staff", templateParameters: ["Customer", "Kesim", "t"] },
      { profileId: "customer-1", displayName: "Customer", phone: "+905550000002", templateKey: "appointment-created-customer", body: "customer", templateParameters: ["Kesim", "t", "Staff"] },
      { profileId: "admin-1", displayName: "Admin 1", phone: "+905550000011", templateKey: "appointment-created-staff", body: "staff", templateParameters: ["Customer", "Kesim", "t"] },
      { profileId: "admin-2", displayName: "Admin 2", phone: "+905550000012", templateKey: "appointment-created-staff", body: "staff", templateParameters: ["Customer", "Kesim", "t"] },
    ];

    type ClaimResult = Awaited<ReturnType<NotificationRepository["claim"]>>;

    function repositoryWith(claim: Mock<NotificationRepository["claim"]>) {
      return {
        recipients: vi.fn().mockResolvedValue(createdRecipients),
        claim,
        markSent: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
        markUnknown: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("isolates a rejected and an ambiguous send so the remaining recipients still receive", async () => {
      const repository = repositoryWith(vi.fn<NotificationRepository["claim"]>().mockResolvedValue("claimed"));
      const provider = {
        channel: "WHATSAPP" as const,
        send: vi.fn(async (message: { to: string }) => {
          if (message.to === "+905550000002") throw new NotificationProviderError("WHATSAPP_PROVIDER_HTTP_400", "rejected");
          if (message.to === "+905550000011") throw new TypeError("fetch failed");
          return { providerMessageId: `wamid.${message.to}` };
        }),
      };

      const result = await createNotificationService({ repository, provider }).publish(
        { tenantId: "tenant-1" as never },
        "appointment-1",
        "APPOINTMENT_CREATED",
      );

      expect(result.results).toEqual([
        { profileId: "staff-1", status: "SENT" },
        { profileId: "customer-1", status: "FAILED" },
        { profileId: "admin-1", status: "UNKNOWN" },
        { profileId: "admin-2", status: "SENT" },
      ]);
      expect(provider.send).toHaveBeenCalledTimes(4);
      expect(repository.claim).toHaveBeenCalledTimes(4);
      expect(repository.claim).toHaveBeenCalledWith(
        { tenantId: "tenant-1" },
        expect.objectContaining({ recipientProfileId: "admin-2", templateKey: "appointment-created-staff", eventType: "APPOINTMENT_CREATED" }),
      );
      expect(repository.markFailed).toHaveBeenCalledOnce();
      expect(repository.markFailed).toHaveBeenCalledWith(
        { tenantId: "tenant-1" },
        expect.objectContaining({ recipientProfileId: "customer-1", errorCode: "WHATSAPP_PROVIDER_HTTP_400" }),
      );
      expect(repository.markUnknown).toHaveBeenCalledOnce();
      expect(repository.markUnknown).toHaveBeenCalledWith(
        { tenantId: "tenant-1" },
        expect.objectContaining({ recipientProfileId: "admin-1", errorCode: "PROVIDER_OUTCOME_UNKNOWN" }),
      );
      expect(repository.markSent).toHaveBeenCalledTimes(2);
      expect(repository.markSent).toHaveBeenCalledWith(
        { tenantId: "tenant-1" },
        expect.objectContaining({ recipientProfileId: "admin-2", providerMessageId: "wamid.+905550000012" }),
      );
    });

    it("does not resend to admins already SENT, PENDING or UNKNOWN on re-publish", async () => {
      const extended = [
        ...createdRecipients,
        { profileId: "admin-3", displayName: "Admin 3", phone: "+905550000013", templateKey: "appointment-created-staff", body: "staff", templateParameters: ["Customer", "Kesim", "t"] },
      ];
      const claimByProfile: Record<string, ClaimResult> = {
        "staff-1": "already_sent",
        "customer-1": "already_sent",
        "admin-1": "already_sent",
        "admin-2": "already_pending",
        "admin-3": "already_unknown",
      };
      const repository = {
        ...repositoryWith(vi.fn<NotificationRepository["claim"]>(async (_context, input) => claimByProfile[input.recipientProfileId])),
        recipients: vi.fn().mockResolvedValue(extended),
      };
      const provider = { channel: "WHATSAPP" as const, send: vi.fn() };

      const result = await createNotificationService({ repository, provider }).publish(
        { tenantId: "tenant-1" as never },
        "appointment-1",
        "APPOINTMENT_CREATED",
      );

      expect(result.results).toEqual([
        { profileId: "staff-1", status: "SENT" },
        { profileId: "customer-1", status: "SENT" },
        { profileId: "admin-1", status: "SENT" },
        { profileId: "admin-2", status: "PENDING" },
        { profileId: "admin-3", status: "UNKNOWN" },
      ]);
      expect(provider.send).not.toHaveBeenCalled();
      expect(repository.markSent).not.toHaveBeenCalled();
      expect(repository.markFailed).not.toHaveBeenCalled();
      expect(repository.markUnknown).not.toHaveBeenCalled();
    });

    it("sends only to the admin whose earlier attempt failed when re-publishing", async () => {
      const claimByProfile: Record<string, ClaimResult> = {
        "staff-1": "already_sent",
        "customer-1": "already_sent",
        "admin-1": "already_unknown",
        "admin-2": "claimed",
      };
      const repository = repositoryWith(vi.fn<NotificationRepository["claim"]>(async (_context, input) => claimByProfile[input.recipientProfileId]));
      const provider = { channel: "WHATSAPP" as const, send: vi.fn().mockResolvedValue({ providerMessageId: "wamid.retry" }) };

      const result = await createNotificationService({ repository, provider }).publish(
        { tenantId: "tenant-1" as never },
        "appointment-1",
        "APPOINTMENT_CREATED",
      );

      expect(result.results).toEqual([
        { profileId: "staff-1", status: "SENT" },
        { profileId: "customer-1", status: "SENT" },
        { profileId: "admin-1", status: "UNKNOWN" },
        { profileId: "admin-2", status: "SENT" },
      ]);
      expect(provider.send).toHaveBeenCalledOnce();
      expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: "+905550000012", templateKey: "appointment-created-staff" }));
    });
  });
});
