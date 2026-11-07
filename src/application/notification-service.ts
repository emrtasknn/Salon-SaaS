import type { TenantContext } from "../domain/tenant-context";
import {
  DEFAULT_NOTIFICATION_EVENT_KEY,
  NotificationProviderError,
  SMS_TEMPLATE_KEYS,
  toSmsText,
  type NotificationChannel,
  type NotificationEventType,
} from "../domain/notification";
import type { NotificationProvider } from "../infrastructure/notifications";
import { logError } from "../infrastructure/log-redaction";
import {
  aggregatePushOutcomes,
  buildAppointmentCreatedPushPayload,
  WEB_PUSH_TEMPLATE_KEY,
  type PushRecipientRole,
  type WebPushOutcome,
  type WebPushSender,
  type WebPushSubscriptionKeys,
} from "../domain/web-push";

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
      /** Omitted or "" for one-off events; see DEFAULT_NOTIFICATION_EVENT_KEY. */
      eventKey?: string;
      channel: NotificationChannel;
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
      /** Omitted or "" for one-off events; see DEFAULT_NOTIFICATION_EVENT_KEY. */
      eventKey?: string;
      channel: NotificationChannel;
      recipientProfileId: string;
      providerMessageId: string;
    }>,
  ): Promise<void>;
  markFailed(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      /** Omitted or "" for one-off events; see DEFAULT_NOTIFICATION_EVENT_KEY. */
      eventKey?: string;
      channel: NotificationChannel;
      recipientProfileId: string;
      errorCode: string;
    }>,
  ): Promise<void>;
  markUnknown(
    tenantContext: TenantContext,
    input: Readonly<{
      appointmentId: string;
      eventType: NotificationEventType;
      /** Omitted or "" for one-off events; see DEFAULT_NOTIFICATION_EVENT_KEY. */
      eventKey?: string;
      channel: NotificationChannel;
      recipientProfileId: string;
      errorCode: string;
    }>,
  ): Promise<void>;
}>;

export type NotificationResult = Readonly<{
  profileId: string;
  status: string;
  channel: NotificationChannel;
}>;

/** WP-09 push-side reads/writes. Delivery rows reuse NotificationRepository (channel WEB_PUSH). */
export type PushNotificationRepository = Readonly<{
  /** Send-time routing (APPOINTMENT_CREATED only); null when the appointment is not visible. */
  pushRecipients(
    tenantContext: TenantContext,
    appointmentId: string,
  ): Promise<Readonly<{
    appointment: Readonly<{ id: string; serviceName: string; startAt: Date; timeZone: string }>;
    recipients: ReadonlyArray<Readonly<{ profileId: string; role: PushRecipientRole }>>;
  }> | null>;
  activeSubscriptions(
    tenantContext: TenantContext,
    profileId: string,
  ): Promise<ReadonlyArray<WebPushSubscriptionKeys & Readonly<{ id: string }>>>;
  recordPushResult(
    tenantContext: TenantContext,
    input: Readonly<{ subscriptionId: string; outcome: WebPushOutcome["kind"]; at: Date }>,
  ): Promise<void>;
}>;

export type WebPushDependencies = Readonly<{
  repository: PushNotificationRepository;
  provider: WebPushSender;
  now?: () => Date;
}>;

export function createNotificationService(
  dependencies: Readonly<{
    repository: NotificationRepository;
    /** WhatsApp provider; null when that channel is not configured (no WhatsApp rows are written). */
    provider: NotificationProvider | null;
    /** Optional Web Push channel (WP-09). */
    webPush?: WebPushDependencies | null;
    /**
     * Optional customer SMS channel (owner decision 2026-11-07). Uses the same recipient list
     * (customer phone only with an active opt-in) filtered to SMS_TEMPLATE_KEYS, so staff and
     * tenant admins never get SMS.
     */
    sms?: NotificationProvider | null;
  }>,
) {
  type MessagingChannel = Readonly<{
    channel: "WHATSAPP" | "SMS";
    provider: NotificationProvider;
    includes: (templateKey: string) => boolean;
    body: (text: string) => string;
  }>;

  async function publishMessages(
    messaging: MessagingChannel,
    tenantContext: TenantContext,
    appointmentId: string,
    eventType: NotificationEventType,
    eventKey: string,
  ): Promise<NotificationResult[]> {
    const { channel, provider } = messaging;
    // Only repeatable events carry a key; one-off events keep the original repository input shape.
    const keyed = eventKey === "" ? {} : { eventKey };
    const allRecipients = await dependencies.repository.recipients(
      tenantContext,
      appointmentId,
      eventType,
    );
    const recipients = allRecipients.filter((recipient) => messaging.includes(recipient.templateKey));
    const results: NotificationResult[] = [];

    for (const recipient of recipients) {
      const claim = await dependencies.repository.claim(tenantContext, {
        appointmentId,
        eventType,
        ...keyed,
        channel,
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

        results.push({ profileId: recipient.profileId, status, channel });
        continue;
      }

      if (!recipient.phone) {
        await dependencies.repository.markFailed(tenantContext, {
          appointmentId,
          eventType,
          ...keyed,
          channel,
          recipientProfileId: recipient.profileId,
          errorCode: "RECIPIENT_PHONE_MISSING",
        });
        results.push({ profileId: recipient.profileId, status: "FAILED", channel });
        continue;
      }

      let sent: Awaited<ReturnType<NotificationProvider["send"]>>;

      try {
        sent = await provider.send({
          to: recipient.phone,
          body: messaging.body(recipient.body),
          templateKey: recipient.templateKey,
          templateParameters: recipient.templateParameters,
        });
      } catch (error) {
        if (error instanceof NotificationProviderError && error.outcome === "rejected") {
          await dependencies.repository.markFailed(tenantContext, {
            appointmentId,
            eventType,
            ...keyed,
            channel,
            recipientProfileId: recipient.profileId,
            errorCode: error.errorCode,
          });
          results.push({ profileId: recipient.profileId, status: "FAILED", channel });
          continue;
        }

        logError("notification_delivery_unknown", {
          tenantId: tenantContext.tenantId,
          appointmentId,
          channel,
          recipientProfileId: recipient.profileId,
          errorCode: "PROVIDER_OUTCOME_UNKNOWN",
        });
        await dependencies.repository.markUnknown(tenantContext, {
          appointmentId,
          eventType,
          ...keyed,
          channel,
          recipientProfileId: recipient.profileId,
          errorCode: "PROVIDER_OUTCOME_UNKNOWN",
        });
        results.push({ profileId: recipient.profileId, status: "UNKNOWN", channel });
        continue;
      }

      // Sağlayıcı mesajı kabul etti. DB hatası, gönderim başarısızlığı anlamına gelmez.
      await dependencies.repository.markSent(tenantContext, {
        appointmentId,
        eventType,
        ...keyed,
        channel,
        recipientProfileId: recipient.profileId,
        providerMessageId: sent.providerMessageId,
      });

      results.push({ profileId: recipient.profileId, status: "SENT", channel });
    }

    return results;
  }

  async function publishWhatsApp(
    tenantContext: TenantContext,
    appointmentId: string,
    eventType: NotificationEventType,
    eventKey: string,
  ): Promise<NotificationResult[]> {
    const provider = dependencies.provider;
    if (!provider) return [];
    return publishMessages(
      { channel: "WHATSAPP", provider, includes: () => true, body: (text) => text },
      tenantContext, appointmentId, eventType, eventKey,
    );
  }

  async function publishSms(
    provider: NotificationProvider,
    tenantContext: TenantContext,
    appointmentId: string,
    eventType: NotificationEventType,
    eventKey: string,
  ): Promise<NotificationResult[]> {
    // No SMS template for APPOINTMENT_CREATED: skip the recipient read entirely.
    if (eventType === "APPOINTMENT_CREATED") return [];
    return publishMessages(
      { channel: "SMS", provider, includes: (templateKey) => SMS_TEMPLATE_KEYS.has(templateKey), body: toSmsText },
      tenantContext, appointmentId, eventType, eventKey,
    );
  }

  async function publishWebPush(
    webPush: WebPushDependencies,
    tenantContext: TenantContext,
    appointmentId: string,
    eventType: NotificationEventType,
  ): Promise<NotificationResult[]> {
    // ADR-044 §4.4: only APPOINTMENT_CREATED is pushed (staff/admins). Never touches Appointment.
    if (eventType !== "APPOINTMENT_CREATED") return [];
    const routing = await webPush.repository.pushRecipients(tenantContext, appointmentId);
    if (!routing) return [];
    const now = webPush.now ?? (() => new Date());
    const results: NotificationResult[] = [];

    for (const recipient of routing.recipients) {
      try {
        const subscriptions = await webPush.repository.activeSubscriptions(tenantContext, recipient.profileId);
        // No active device: skip without a delivery row (owner decision; ADR-044 §4.2 amended).
        if (subscriptions.length === 0) continue;

        const claim = await dependencies.repository.claim(tenantContext, {
          appointmentId,
          eventType,
          channel: "WEB_PUSH",
          recipientProfileId: recipient.profileId,
          templateKey: WEB_PUSH_TEMPLATE_KEY,
        });
        if (claim !== "claimed") {
          const status = claim === "already_sent" ? "SENT" : claim === "already_unknown" ? "UNKNOWN" : "PENDING";
          results.push({ profileId: recipient.profileId, status, channel: "WEB_PUSH" });
          continue;
        }

        const payload = buildAppointmentCreatedPushPayload({
          appointmentId: routing.appointment.id,
          serviceName: routing.appointment.serviceName,
          startAt: routing.appointment.startAt,
          timeZone: routing.appointment.timeZone,
          role: recipient.role,
        });
        const outcomes = await Promise.all(subscriptions.map(async (subscription) => {
          let outcome: WebPushOutcome;
          try {
            outcome = await webPush.provider.send(
              { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
              payload,
              { urgency: "high" },
            );
          } catch {
            // Providers must not throw; treat a throw as an ambiguous outcome.
            outcome = { kind: "network" };
          }
          try {
            await webPush.repository.recordPushResult(tenantContext, { subscriptionId: subscription.id, outcome: outcome.kind, at: now() });
          } catch {
            logError("web_push_subscription_update_failed", { tenantId: tenantContext.tenantId, subscriptionId: subscription.id });
          }
          return outcome;
        }));

        const delivery = aggregatePushOutcomes(outcomes);
        const target = { appointmentId, eventType, channel: "WEB_PUSH" as const, recipientProfileId: recipient.profileId };
        if (delivery.status === "SENT") {
          await dependencies.repository.markSent(tenantContext, { ...target, providerMessageId: delivery.providerMessageId });
        } else if (delivery.status === "UNKNOWN") {
          logError("notification_delivery_unknown", {
            tenantId: tenantContext.tenantId, appointmentId, channel: "WEB_PUSH", recipientProfileId: recipient.profileId, errorCode: delivery.errorCode,
          });
          await dependencies.repository.markUnknown(tenantContext, { ...target, errorCode: delivery.errorCode });
        } else {
          await dependencies.repository.markFailed(tenantContext, { ...target, errorCode: delivery.errorCode });
        }
        results.push({ profileId: recipient.profileId, status: delivery.status, channel: "WEB_PUSH" });
      } catch {
        // One recipient's persistence error must not block the other recipients.
        logError("web_push_recipient_failed", { tenantId: tenantContext.tenantId, appointmentId, recipientProfileId: recipient.profileId });
        results.push({ profileId: recipient.profileId, status: "UNKNOWN", channel: "WEB_PUSH" });
      }
    }
    return results;
  }

  return {
    async publish(
      tenantContext: TenantContext,
      appointmentId: string,
      eventType: NotificationEventType,
      eventKey: string = DEFAULT_NOTIFICATION_EVENT_KEY,
    ) {
      const webPush = dependencies.webPush;
      const sms = dependencies.sms;
      if (!webPush && !sms) {
        // Pre-WP-09 behaviour: WhatsApp errors propagate to the caller.
        const results = await publishWhatsApp(tenantContext, appointmentId, eventType, eventKey);
        return { status: "processed" as const, results };
      }

      // Channels are independent: one channel's failure never blocks the others.
      const channels: Array<Readonly<{ channel: NotificationChannel; run: Promise<NotificationResult[]> }>> = [
        { channel: "WHATSAPP", run: publishWhatsApp(tenantContext, appointmentId, eventType, eventKey) },
      ];
      if (sms) channels.push({ channel: "SMS", run: publishSms(sms, tenantContext, appointmentId, eventType, eventKey) });
      if (webPush) channels.push({ channel: "WEB_PUSH", run: publishWebPush(webPush, tenantContext, appointmentId, eventType) });

      const settled = await Promise.allSettled(channels.map((entry) => entry.run));
      const first = settled[0];
      if (first.status === "rejected" && settled.every((outcome) => outcome.status === "rejected")) throw first.reason;
      const results: NotificationResult[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") results.push(...outcome.value);
        else logError("notification_channel_failed", { tenantId: tenantContext.tenantId, appointmentId, channel: channels[index].channel });
      });
      return { status: "processed" as const, results };
    },
  };
}
