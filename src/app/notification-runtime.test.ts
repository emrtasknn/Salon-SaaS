import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WP-09 QA: channels are configured independently; NOT_CONFIGURED only when both
// WhatsApp and Web Push are unconfigured. Fake test-only values; no real secrets.
const { createNotificationService, publish, whatsAppProvider, pushProvider, createWebPushProvider, isWhatsAppSenderBoundToTenant } = vi.hoisted(() => {
  const publish = vi.fn();
  return {
    publish,
    createNotificationService: vi.fn(() => ({ publish })),
    whatsAppProvider: { channel: "WHATSAPP", send: vi.fn() },
    pushProvider: { send: vi.fn() },
    createWebPushProvider: vi.fn(),
    isWhatsAppSenderBoundToTenant: vi.fn(),
  };
});

vi.mock("../application/notification-service", () => ({ createNotificationService }));
vi.mock("../infrastructure/notifications", () => ({ createMetaWhatsAppProvider: vi.fn(() => whatsAppProvider) }));
vi.mock("../infrastructure/web-push-provider", () => ({ createWebPushProvider }));
vi.mock("../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => ({ marker: "prisma" })) }));
vi.mock("../persistence/prisma-notification", () => ({ createPrismaNotificationRepository: vi.fn(() => ({ marker: "delivery-repo" })) }));
vi.mock("../persistence/prisma-whatsapp-integration", () => ({ isWhatsAppSenderBoundToTenant }));
vi.mock("../persistence/prisma-push-subscription", () => ({ createPrismaPushNotificationRepository: vi.fn(() => ({ marker: "push-repo" })) }));

import { publishAppointmentNotification } from "./notification-runtime";

const WHATSAPP = {
  WHATSAPP_ACCESS_TOKEN: "test-access-token",
  WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_API_VERSION: "v21.0",
  WHATSAPP_TEMPLATES_JSON: "{}",
};
const VAPID = {
  WEB_PUSH_VAPID_PUBLIC_KEY: `B${"a".repeat(86)}`,
  WEB_PUSH_VAPID_PRIVATE_KEY: "c".repeat(43),
  WEB_PUSH_VAPID_SUBJECT: "mailto:ops@example.com",
};
const KEYS = [...Object.keys(WHATSAPP), ...Object.keys(VAPID)];
const saved: Record<string, string | undefined> = {};
const tenant = { tenantId: "tenant-1" as never };

function configure(whatsApp: boolean, push: boolean) {
  for (const [key, value] of Object.entries(WHATSAPP)) {
    if (whatsApp) process.env[key] = value; else delete process.env[key];
  }
  for (const [key, value] of Object.entries(VAPID)) {
    if (push) process.env[key] = value; else delete process.env[key];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of KEYS) saved[key] = process.env[key];
  createWebPushProvider.mockReturnValue(pushProvider);
  isWhatsAppSenderBoundToTenant.mockResolvedValue(true);
  publish.mockResolvedValue({ status: "processed", results: [] });
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("publishAppointmentNotification channel wiring (WP-09)", () => {
  it("returns NOT_CONFIGURED only when neither channel is configured", async () => {
    configure(false, false);
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "NOT_CONFIGURED" });
    expect(createNotificationService).not.toHaveBeenCalled();
  });

  it("publishes with push only when WhatsApp env is missing", async () => {
    configure(false, true);
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "processed", results: [] });
    expect(createNotificationService).toHaveBeenCalledWith(expect.objectContaining({
      provider: null,
      webPush: { repository: { marker: "push-repo" }, provider: pushProvider },
    }));
  });

  it("publishes with WhatsApp only (webPush null) when VAPID env is missing", async () => {
    configure(true, false);
    await publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CONFIRMED");
    expect(createWebPushProvider).not.toHaveBeenCalled();
    expect(createNotificationService).toHaveBeenCalledWith(expect.objectContaining({ provider: whatsAppProvider, webPush: null }));
  });

  it("treats a malformed VAPID config as unconfigured and logs without key material", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    configure(false, true);
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "bad-private-key-value";
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "NOT_CONFIGURED" });
    expect(log).toHaveBeenCalledWith("web_push_config_invalid", expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain("bad-private-key-value");
  });

  it("returns FAILED (never throws) when the service rejects", async () => {
    configure(true, true);
    publish.mockRejectedValue(new Error("db down"));
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "FAILED" });
  });
});

describe("publishAppointmentNotification WhatsApp sender binding (WP-15)", () => {
  it("checks the configured sender against the server-side tenant context", async () => {
    configure(true, false);
    await publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(isWhatsAppSenderBoundToTenant).toHaveBeenCalledWith({ marker: "prisma" }, tenant, "123");
    expect(createNotificationService).toHaveBeenCalledWith(expect.objectContaining({ provider: whatsAppProvider }));
  });

  it("does not look up a binding when WhatsApp env is missing", async () => {
    configure(false, true);
    await publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED");
    expect(isWhatsAppSenderBoundToTenant).not.toHaveBeenCalled();
  });

  it("drops the WhatsApp channel for a tenant the sender is not bound to; push still publishes", async () => {
    configure(true, true);
    isWhatsAppSenderBoundToTenant.mockResolvedValue(false);
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "processed", results: [] });
    expect(createNotificationService).toHaveBeenCalledWith(expect.objectContaining({
      provider: null,
      webPush: { repository: { marker: "push-repo" }, provider: pushProvider },
    }));
  });

  it("returns NOT_CONFIGURED for an unbound tenant when push is also unavailable", async () => {
    configure(true, false);
    isWhatsAppSenderBoundToTenant.mockResolvedValue(false);
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "NOT_CONFIGURED" });
    expect(createNotificationService).not.toHaveBeenCalled();
  });

  it("fails closed when the binding check throws: no WhatsApp, logged without secrets, push still publishes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    configure(true, true);
    isWhatsAppSenderBoundToTenant.mockRejectedValue(new Error("db down"));
    await expect(publishAppointmentNotification(tenant, "appt-1", "APPOINTMENT_CREATED")).resolves.toEqual({ status: "processed", results: [] });
    expect(createNotificationService).toHaveBeenCalledWith(expect.objectContaining({ provider: null }));
    expect(log).toHaveBeenCalledWith("whatsapp_sender_binding_check_failed", expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-access-token");
  });
});
