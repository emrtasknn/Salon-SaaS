import type { TenantContext } from "../domain/tenant-context";
import type { NotificationEventType } from "../domain/notification";
import type { NotificationProvider } from "../infrastructure/notifications";

export type NotificationRepository = Readonly<{
  recipients(tenantContext: TenantContext, appointmentId: string, eventType: NotificationEventType): Promise<ReadonlyArray<{
    profileId: string; displayName: string; phone: string | null; templateKey: string; body: string; templateParameters: ReadonlyArray<string>;
  }>>;
  claim(tenantContext: TenantContext, input: Readonly<{
    appointmentId: string; eventType: NotificationEventType; channel: "WHATSAPP"; recipientProfileId: string; templateKey: string;
  }>): Promise<"claimed" | "already_sent" | "already_pending">;
  markSent(tenantContext: TenantContext, input: Readonly<{
    appointmentId: string; eventType: NotificationEventType; channel: "WHATSAPP"; recipientProfileId: string; providerMessageId: string;
  }>): Promise<void>;
  markFailed(tenantContext: TenantContext, input: Readonly<{
    appointmentId: string; eventType: NotificationEventType; channel: "WHATSAPP"; recipientProfileId: string; errorCode: string;
  }>): Promise<void>;
}>;

export function createNotificationService(dependencies: Readonly<{ repository: NotificationRepository; provider: NotificationProvider }>) {
  return {
    async publish(tenantContext: TenantContext, appointmentId: string, eventType: NotificationEventType) {
      const recipients = await dependencies.repository.recipients(tenantContext, appointmentId, eventType);
      const results: Array<{ profileId: string; status: string }> = [];
      for (const recipient of recipients) {
        if (!recipient.phone) {
          await dependencies.repository.markFailed(tenantContext, { appointmentId, eventType, channel: "WHATSAPP", recipientProfileId: recipient.profileId, errorCode: "RECIPIENT_PHONE_MISSING" });
          results.push({ profileId: recipient.profileId, status: "FAILED" });
          continue;
        }
        const claim = await dependencies.repository.claim(tenantContext, {
          appointmentId, eventType, channel: "WHATSAPP", recipientProfileId: recipient.profileId, templateKey: recipient.templateKey,
        });
        if (claim !== "claimed") {
          results.push({ profileId: recipient.profileId, status: claim === "already_sent" ? "SENT" : "PENDING" });
          continue;
        }
        try {
          const sent = await dependencies.provider.send({
            to: recipient.phone,
            body: recipient.body,
            templateKey: recipient.templateKey,
            templateParameters: recipient.templateParameters,
          });
          await dependencies.repository.markSent(tenantContext, { appointmentId, eventType, channel: "WHATSAPP", recipientProfileId: recipient.profileId, providerMessageId: sent.providerMessageId });
          results.push({ profileId: recipient.profileId, status: "SENT" });
        } catch {
          await dependencies.repository.markFailed(tenantContext, { appointmentId, eventType, channel: "WHATSAPP", recipientProfileId: recipient.profileId, errorCode: "PROVIDER_SEND_FAILED" });
          results.push({ profileId: recipient.profileId, status: "FAILED" });
        }
      }
      return { status: "processed" as const, results };
    },
  };
}
