import type { TenantContext } from "../domain/tenant-context";
import type { NotificationEventType } from "../domain/notification";
import type { NotificationProvider } from "../infrastructure/notifications";

export type NotificationRepository = Readonly<{
  recipients(
    tenantContext: TenantContext,
    appointmentId: string,
    eventType: NotificationEventType,
  ): Promise<
    ReadonlyArray<{
      profileId: string;
      displayName: string;
      phone: string | null;
      templateKey: string;
      body: string;
      templateParameters: ReadonlyArray<string>;
    }>
  >;
  claim(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      channel: "WHATSAPP";
      recipientProfileId: string;
      templateKey: string;
    }>,
  ): Promise<
    "claimed" | "already_sent" | "already_pending" | "already_unknown"
  >;
  markSent(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      channel: "WHATSAPP";
      recipientProfileId: string;
      providerMessageId: string;
    }>,
  ): Promise<void>;
  markFailed(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      channel: "WHATSAPP";
      recipientProfileId: string;
      errorCode: string;
    }>,
  ): Promise<void>;
  markUnknown(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      channel: "WHATSAPP";
      recipientProfileId: string;
      errorCode: string;
    }>,
  ): Promise<void>;
}>;

export function createNotificationService(
  dependencies: Readonly<{
    repository: NotificationRepository;
    provider: NotificationProvider;
  }>,
) {
  return {
    async publish(
      tenantContext: TenantContext,
      appointmentId: string,
      eventType: NotificationEventType,
    ) {
      const recipients = await dependencies.repository.recipients(
        tenantContext,
        appointmentId,
        eventType,
      );
      const results: Array<{ profileId: string; status: string }> = [];

      for (const recipient of recipients) {
        const claim = await dependencies.repository.claim(tenantContext, {
          appointmentId,
          eventType,
          channel: "WHATSAPP",
          recipientProfileId: recipient.profileId,
          templateKey: recipient.templateKey,
        });

        if (claim !== "claimed") {
          const status =
            claim === "already_sent"
              ? "SENT"
              : claim === "already_unknown"
                ? "UNKNOWN"
                : "PENDING";

          results.push({ profileId: recipient.profileId, status });
          continue;
        }

        if (!recipient.phone) {
          await dependencies.repository.markFailed(tenantContext, {
            appointmentId,
            eventType,
            channel: "WHATSAPP",
            recipientProfileId: recipient.profileId,
            errorCode: "RECIPIENT_PHONE_MISSING",
          });
          results.push({ profileId: recipient.profileId, status: "FAILED" });
          continue;
        }

        let sent: Awaited<ReturnType<NotificationProvider["send"]>>;

        try {
          sent = await dependencies.provider.send({
            to: recipient.phone,
            body: recipient.body,
            templateKey: recipient.templateKey,
            templateParameters: recipient.templateParameters,
          });
        } catch {
          console.error("notification_delivery_unknown", {
            tenantId: tenantContext.tenantId,
            appointmentId,
            channel: "WHATSAPP",
            recipientProfileId: recipient.profileId,
            errorCode: "PROVIDER_OUTCOME_UNKNOWN",
          });
          await dependencies.repository.markUnknown(tenantContext, {
            appointmentId,
            eventType,
            channel: "WHATSAPP",
            recipientProfileId: recipient.profileId,
            errorCode: "PROVIDER_OUTCOME_UNKNOWN",
          });
          results.push({ profileId: recipient.profileId, status: "UNKNOWN" });
          continue;
        }

        // Sağlayıcı mesajı kabul etti. DB hatası, gönderim başarısızlığı anlamına gelmez.
        await dependencies.repository.markSent(tenantContext, {
          appointmentId,
          eventType,
          channel: "WHATSAPP",
          recipientProfileId: recipient.profileId,
          providerMessageId: sent.providerMessageId,
        });

        results.push({ profileId: recipient.profileId, status: "SENT" });
      }

      return { status: "processed" as const, results };
    },
  };
}
