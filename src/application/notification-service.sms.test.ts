import { describe, expect, it, vi } from "vitest";
import { createNotificationService } from "./notification-service";
import { NotificationProviderError, type NotificationEventType } from "../domain/notification";

const tenant = { tenantId: "tenant-1" as never };

const staff = { profileId: "staff-1", displayName: "Ayşe", phone: "+905550000001", templateKey: "appointment-created-staff", body: "Salon Ada: yeni randevu talebi", templateParameters: [] };
const admin = { profileId: "admin-1", displayName: "Yönetici", phone: "+905550000002", templateKey: "appointment-created-staff", body: "Salon Ada: yeni randevu talebi", templateParameters: [] };
const customerCreated = { profileId: "cust-1", displayName: "Müşteri", phone: "+905550000003", templateKey: "appointment-created-customer", body: "Salon Ada: randevu talebiniz oluşturuldu", templateParameters: [] };
const customerConfirmed = { profileId: "cust-1", displayName: "Müşteri", phone: "+905550000003", templateKey: "appointment-confirmed-customer", body: "Salon Ada: randevunuz onaylandı. Saç kesimi — 08.11.2026 14:00 — Ayşe.", templateParameters: [] };

function repository(recipients: ReadonlyArray<typeof staff>) {
  return {
    recipients: vi.fn().mockResolvedValue(recipients),
    claim: vi.fn().mockResolvedValue("claimed"),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markUnknown: vi.fn().mockResolvedValue(undefined),
  };
}

function smsProvider() {
  return { channel: "SMS" as const, send: vi.fn().mockResolvedValue({ providerMessageId: "SM123" }) };
}

describe("notification service — customer SMS (owner decision 2026-11-07)", () => {
  it.each<NotificationEventType>(["APPOINTMENT_CONFIRMED", "APPOINTMENT_REJECTED", "APPOINTMENT_RESCHEDULED"])(
    "sends %s to the customer as plain-ASCII SMS and records an SMS delivery",
    async (eventType) => {
      const templateKey = {
        APPOINTMENT_CONFIRMED: "appointment-confirmed-customer",
        APPOINTMENT_REJECTED: "appointment-rejected-customer",
        APPOINTMENT_RESCHEDULED: "appointment-rescheduled-customer",
        APPOINTMENT_CREATED: "",
      }[eventType];
      const repo = repository([{ ...customerConfirmed, templateKey }]);
      const sms = smsProvider();
      const result = await createNotificationService({ repository: repo, provider: null, sms }).publish(tenant, "appt-1", eventType);

      expect(result.results).toEqual([{ profileId: "cust-1", status: "SENT", channel: "SMS" }]);
      expect(sms.send).toHaveBeenCalledWith(expect.objectContaining({
        to: "+905550000003",
        body: "Salon Ada: randevunuz onaylandi. Sac kesimi - 08.11.2026 14:00 - Ayse.",
      }));
      expect(repo.claim).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "SMS", recipientProfileId: "cust-1", templateKey }));
      expect(repo.markSent).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "SMS", providerMessageId: "SM123" }));
    },
  );

  it("never sends SMS for APPOINTMENT_CREATED and does not even read recipients", async () => {
    const repo = repository([staff, customerCreated, admin]);
    const sms = smsProvider();
    const result = await createNotificationService({ repository: repo, provider: null, sms }).publish(tenant, "appt-1", "APPOINTMENT_CREATED");

    expect(result.results).toEqual([]);
    expect(sms.send).not.toHaveBeenCalled();
    expect(repo.recipients).not.toHaveBeenCalled();
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("never sends SMS to staff or tenant admins, even if the repository returned them", async () => {
    const repo = repository([staff, admin, customerConfirmed]);
    const sms = smsProvider();
    await createNotificationService({ repository: repo, provider: null, sms }).publish(tenant, "appt-1", "APPOINTMENT_CONFIRMED");

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0][0].to).toBe("+905550000003");
    expect(repo.claim).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the customer has no active opt-in (repository returns no customer)", async () => {
    const repo = repository([]);
    const sms = smsProvider();
    const result = await createNotificationService({ repository: repo, provider: null, sms }).publish(tenant, "appt-1", "APPOINTMENT_CONFIRMED");
    expect(result.results).toEqual([]);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("keeps WhatsApp unchanged next to SMS: WhatsApp gets the original text, SMS the ASCII text", async () => {
    const repo = repository([customerConfirmed]);
    const sms = smsProvider();
    const whatsApp = { channel: "WHATSAPP" as const, send: vi.fn().mockResolvedValue({ providerMessageId: "wamid.1" }) };
    const result = await createNotificationService({ repository: repo, provider: whatsApp, sms }).publish(tenant, "appt-1", "APPOINTMENT_CONFIRMED");

    expect(result.results).toEqual([
      { profileId: "cust-1", status: "SENT", channel: "WHATSAPP" },
      { profileId: "cust-1", status: "SENT", channel: "SMS" },
    ]);
    expect(whatsApp.send.mock.calls[0][0].body).toBe(customerConfirmed.body);
    expect(sms.send.mock.calls[0][0].body).not.toMatch(/[^\x20-\x7E]/);
  });

  it("marks a rejected SMS as FAILED with the provider error code", async () => {
    const repo = repository([customerConfirmed]);
    const sms = { channel: "SMS" as const, send: vi.fn().mockRejectedValue(new NotificationProviderError("TWILIO_21608", "rejected")) };
    const result = await createNotificationService({ repository: repo, provider: null, sms }).publish(tenant, "appt-1", "APPOINTMENT_CONFIRMED");

    expect(result.results).toEqual([{ profileId: "cust-1", status: "FAILED", channel: "SMS" }]);
    expect(repo.markFailed).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "SMS", errorCode: "TWILIO_21608" }));
  });

  it("an SMS channel failure does not block WhatsApp", async () => {
    const repo = repository([customerConfirmed]);
    repo.claim.mockImplementation(async (_t: unknown, input: { channel: string }) => {
      if (input.channel === "SMS") throw new Error("db down");
      return "claimed";
    });
    const whatsApp = { channel: "WHATSAPP" as const, send: vi.fn().mockResolvedValue({ providerMessageId: "wamid.1" }) };
    const result = await createNotificationService({ repository: repo, provider: whatsApp, sms: smsProvider() })
      .publish(tenant, "appt-1", "APPOINTMENT_CONFIRMED");
    expect(result.results).toEqual([{ profileId: "cust-1", status: "SENT", channel: "WHATSAPP" }]);
  });

  it("passes the reschedule eventKey through to the SMS delivery row", async () => {
    const repo = repository([{ ...customerConfirmed, templateKey: "appointment-rescheduled-customer" }]);
    await createNotificationService({ repository: repo, provider: null, sms: smsProvider() })
      .publish(tenant, "appt-1", "APPOINTMENT_RESCHEDULED", "move-1");
    expect(repo.claim).toHaveBeenCalledWith(tenant, expect.objectContaining({ channel: "SMS", eventKey: "move-1" }));
  });
});
