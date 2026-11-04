import { describe, expect, it, vi } from "vitest";
import { createNotificationService, type PushNotificationRepository } from "./notification-service";
import { NotificationProviderError } from "../domain/notification";
import type { WebPushOutcome, WebPushSender } from "../domain/web-push";

const tenant = { tenantId: "tenant-1" as never };
const P256DH = `B${"a".repeat(86)}`;
const AUTH = "b".repeat(22);

function deliveryRepository(overrides: Record<string, unknown> = {}) {
  return {
    recipients: vi.fn().mockResolvedValue([
      { profileId: "staff-1", displayName: "Staff", phone: "+905551112233", templateKey: "appointment-created-staff", body: "b", templateParameters: [] },
    ]),
    claim: vi.fn().mockResolvedValue("claimed"),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markUnknown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function whatsApp() {
  return { channel: "WHATSAPP" as const, send: vi.fn().mockResolvedValue({ providerMessageId: "wamid.1" }) };
}

function sub(id: string) {
  return { id, endpoint: `https://push.example.com/${id}`, p256dh: P256DH, auth: AUTH };
}

function pushRepository(subscriptions: Record<string, ReturnType<typeof sub>[]>, recipients = [
  { profileId: "staff-1", role: "STAFF" as const },
  { profileId: "admin-1", role: "TENANT_ADMIN" as const },
]) {
  return {
    pushRecipients: vi.fn().mockResolvedValue({
      appointment: { id: "appt-1", serviceName: "Saç kesimi", startAt: new Date("2026-11-05T10:00:00Z"), timeZone: "Europe/Istanbul" },
      recipients,
    }),
    activeSubscriptions: vi.fn(async (_t: unknown, profileId: string) => subscriptions[profileId] ?? []),
    recordPushResult: vi.fn().mockResolvedValue(undefined),
  } satisfies PushNotificationRepository;
}

function pushProvider(outcome: WebPushOutcome | ((endpoint: string) => WebPushOutcome) = { kind: "ok" }) {
  return {
    send: vi.fn<WebPushSender["send"]>(async (s) => (typeof outcome === "function" ? outcome(s.endpoint) : outcome)),
  };
}

describe("notification service — multi-channel (WP-09)", () => {
  it("sends WhatsApp and Web Push independently and tags every result with its channel", async () => {
    const repository = deliveryRepository();
    const push = pushRepository({ "staff-1": [sub("d1"), sub("d2")], "admin-1": [sub("d3")] });
    const provider = pushProvider();
    const result = await createNotificationService({ repository, provider: whatsApp(), webPush: { repository: push, provider } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");

    expect(result.results).toEqual([
      { profileId: "staff-1", status: "SENT", channel: "WHATSAPP" },
      { profileId: "staff-1", status: "SENT", channel: "WEB_PUSH" },
      { profileId: "admin-1", status: "SENT", channel: "WEB_PUSH" },
    ]);
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(provider.send.mock.calls[0][2]).toEqual({ urgency: "high" });
    expect(repository.claim).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "WEB_PUSH", templateKey: "appointment-created-push", recipientProfileId: "staff-1" }));
    expect(repository.markSent).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "WEB_PUSH", recipientProfileId: "staff-1", providerMessageId: "webpush:2/2" }));
    const payloads = provider.send.mock.calls.map(call => JSON.parse(call[1]));
    expect(payloads.map(p => p.url)).toEqual(["/staff/appointments", "/staff/appointments", "/admin/calendar"]);
  });

  it("a WhatsApp failure does not block push", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockRejectedValue(new Error("whatsapp db down")) });
    const provider = pushProvider();
    const result = await createNotificationService({
      repository, provider: whatsApp(), webPush: { repository: pushRepository({ "staff-1": [sub("d1")] }), provider },
    }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "staff-1", status: "SENT", channel: "WEB_PUSH" }]);
  });

  it("a push failure does not block WhatsApp", async () => {
    const repository = deliveryRepository();
    const push = pushRepository({});
    push.pushRecipients.mockRejectedValue(new Error("push db down"));
    const wa = whatsApp();
    const result = await createNotificationService({ repository, provider: wa, webPush: { repository: push, provider: pushProvider() } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "staff-1", status: "SENT", channel: "WHATSAPP" }]);
    expect(wa.send).toHaveBeenCalledOnce();
  });

  it("a WhatsApp provider rejection does not block push", async () => {
    const wa = { channel: "WHATSAPP" as const, send: vi.fn().mockRejectedValue(new NotificationProviderError("WHATSAPP_PROVIDER_HTTP_400", "rejected")) };
    const result = await createNotificationService({
      repository: deliveryRepository(), provider: wa, webPush: { repository: pushRepository({ "admin-1": [sub("d1")] }), provider: pushProvider() },
    }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([
      { profileId: "staff-1", status: "FAILED", channel: "WHATSAPP" },
      { profileId: "admin-1", status: "SENT", channel: "WEB_PUSH" },
    ]);
  });

  it("rejects only when both channels fail", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockRejectedValue(new Error("db down")) });
    const push = pushRepository({});
    push.pushRecipients.mockRejectedValue(new Error("db down"));
    await expect(createNotificationService({ repository, provider: whatsApp(), webPush: { repository: push, provider: pushProvider() } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED")).rejects.toThrow("db down");
  });

  it("writes no WEB_PUSH delivery row when the recipient has no active subscription", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockResolvedValue([]) });
    const provider = pushProvider();
    const result = await createNotificationService({ repository, provider: whatsApp(), webPush: { repository: pushRepository({}), provider } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([]);
    expect(repository.claim).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it.each(["APPOINTMENT_CONFIRMED", "APPOINTMENT_REJECTED"] as const)("never pushes %s", async (eventType) => {
    const repository = deliveryRepository();
    const push = pushRepository({ "staff-1": [sub("d1")] });
    const provider = pushProvider();
    await createNotificationService({ repository, provider: whatsApp(), webPush: { repository: push, provider } }).publish(tenant, "appt-1", eventType);
    expect(push.pushRecipients).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.claim).not.toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "WEB_PUSH" }));
  });

  it("with WhatsApp unconfigured, writes no WhatsApp rows and still pushes", async () => {
    const repository = deliveryRepository();
    const result = await createNotificationService({
      repository, provider: null, webPush: { repository: pushRepository({ "staff-1": [sub("d1")] }), provider: pushProvider() },
    }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(repository.recipients).not.toHaveBeenCalled();
    expect(result.results).toEqual([{ profileId: "staff-1", status: "SENT", channel: "WEB_PUSH" }]);
  });

  it("records each device outcome and marks FAILED when no device accepted", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockResolvedValue([]) });
    const push = pushRepository({ "staff-1": [sub("gone"), sub("busy")] }, [{ profileId: "staff-1", role: "STAFF" }]);
    const provider = pushProvider((endpoint) => (endpoint.endsWith("gone") ? { kind: "gone" } : { kind: "transient" }));
    const result = await createNotificationService({ repository, provider: null, webPush: { repository: push, provider, now: () => new Date(0) } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "staff-1", status: "FAILED", channel: "WEB_PUSH" }]);
    expect(push.recordPushResult).toHaveBeenCalledWith(tenant, { subscriptionId: "gone", outcome: "gone", at: new Date(0) });
    expect(push.recordPushResult).toHaveBeenCalledWith(tenant, { subscriptionId: "busy", outcome: "transient", at: new Date(0) });
    expect(repository.markFailed).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "WEB_PUSH", errorCode: "WEB_PUSH_TRANSIENT_ERROR" }));
  });

  it("marks UNKNOWN on a network/timeout outcome", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockResolvedValue([]) });
    const result = await createNotificationService({
      repository, provider: null,
      webPush: { repository: pushRepository({ "staff-1": [sub("d1")] }, [{ profileId: "staff-1", role: "STAFF" }]), provider: pushProvider({ kind: "network" }) },
    }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "staff-1", status: "UNKNOWN", channel: "WEB_PUSH" }]);
    expect(repository.markUnknown).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "WEB_PUSH", errorCode: "WEB_PUSH_OUTCOME_UNKNOWN" }));
  });

  it("does not resend when the WEB_PUSH row was already sent", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockResolvedValue([]), claim: vi.fn().mockResolvedValue("already_sent") });
    const provider = pushProvider();
    const result = await createNotificationService({
      repository, provider: null, webPush: { repository: pushRepository({ "staff-1": [sub("d1")] }, [{ profileId: "staff-1", role: "STAFF" }]), provider },
    }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "staff-1", status: "SENT", channel: "WEB_PUSH" }]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("one recipient's persistence error does not block the next recipient", async () => {
    const repository = deliveryRepository({ recipients: vi.fn().mockResolvedValue([]) });
    const push = pushRepository({ "admin-1": [sub("d1")] });
    push.activeSubscriptions.mockImplementationOnce(async () => { throw new Error("db"); });
    const result = await createNotificationService({ repository, provider: null, webPush: { repository: push, provider: pushProvider() } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([
      { profileId: "staff-1", status: "UNKNOWN", channel: "WEB_PUSH" },
      { profileId: "admin-1", status: "SENT", channel: "WEB_PUSH" },
    ]);
  });

  it("WhatsApp calls are identical with and without the push channel", async () => {
    const withoutPush = deliveryRepository();
    const waA = whatsApp();
    await createNotificationService({ repository: withoutPush, provider: waA }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    const withPush = deliveryRepository();
    const waB = whatsApp();
    await createNotificationService({ repository: withPush, provider: waB, webPush: { repository: pushRepository({}), provider: pushProvider() } })
      .publish(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(waB.send.mock.calls).toEqual(waA.send.mock.calls);
    expect(withPush.claim.mock.calls).toEqual(withoutPush.claim.mock.calls);
    expect(withPush.markSent.mock.calls).toEqual(withoutPush.markSent.mock.calls);
  });
});
