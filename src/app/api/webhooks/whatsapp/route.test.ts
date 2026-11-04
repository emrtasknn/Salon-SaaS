import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    status: number;
    body: string;
    constructor(body: string, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200; }
    static json(value: unknown) { return { status: 200, json: async () => value }; }
  },
}));

const persistence = vi.hoisted(() => ({
  resolveWhatsAppTenantId: vi.fn(),
  resolveWhatsAppDeliveryTenantId: vi.fn(),
  applyWhatsAppWebhookStatuses: vi.fn(),
}));
const logInfo = vi.hoisted(() => vi.fn());

vi.mock("../../../../persistence/prisma-whatsapp-webhook", () => persistence);
vi.mock("../../../../infrastructure/prisma-runtime", () => ({ getPrisma: () => ({ fake: "prisma" }) }));
vi.mock("../../../../infrastructure/log-redaction", () => ({ logInfo }));

import { GET, POST } from "./route";

const APP_SECRET = "secret";
const SHARED = "shared-phone-id";

function signedRequest(body: string) {
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
  return new Request("https://example.test/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": signature },
    body,
  });
}

function payload(phoneNumberId: string, statuses: ReadonlyArray<{ id: string; status: string }>) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses } }] }],
  });
}

async function responseJson(response: unknown) {
  return (response as { json: () => Promise<Record<string, unknown>> }).json();
}

describe("WhatsApp webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", SHARED);
    persistence.resolveWhatsAppTenantId.mockReset();
    persistence.resolveWhatsAppDeliveryTenantId.mockReset();
    persistence.applyWhatsAppWebhookStatuses.mockReset().mockImplementation(
      async (_prisma: unknown, _ctx: unknown, statuses: readonly unknown[]) => statuses.length,
    );
    logInfo.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid verification token", async () => {
    const response = await GET(new Request("https://example.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=x"));
    expect(response.status).toBe(403);
  });

  it("rejects invalid webhook signature", async () => {
    const request = new Request("https://example.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=bad" },
      body: '{"entry":[]}',
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(persistence.resolveWhatsAppDeliveryTenantId).not.toHaveBeenCalled();
    expect(persistence.applyWhatsAppWebhookStatuses).not.toHaveBeenCalled();
  });

  it("returns 400 for a validly signed but malformed JSON body", async () => {
    const response = await POST(signedRequest("{not json"));
    expect(response.status).toBe(400);
    expect(persistence.applyWhatsAppWebhookStatuses).not.toHaveBeenCalled();
  });

  it("resolves shared-sender statuses per wamid and applies once per tenant", async () => {
    persistence.resolveWhatsAppDeliveryTenantId.mockImplementation(async (_prisma: unknown, wamid: string) =>
      wamid.startsWith("wamid.A") ? "tenant-a" : "tenant-b");

    const response = await POST(signedRequest(payload(SHARED, [
      { id: "wamid.A1", status: "delivered" },
      { id: "wamid.B1", status: "delivered" },
      { id: "wamid.A2", status: "failed" },
    ])));

    expect(response.status).toBe(200);
    expect(persistence.resolveWhatsAppDeliveryTenantId).toHaveBeenCalledTimes(3);
    expect(persistence.resolveWhatsAppTenantId).not.toHaveBeenCalled();
    expect(persistence.applyWhatsAppWebhookStatuses).toHaveBeenCalledTimes(2);

    const calls = persistence.applyWhatsAppWebhookStatuses.mock.calls;
    const byTenant = new Map(calls.map(([, ctx, statuses]) => [
      (ctx as { tenantId: string }).tenantId,
      (statuses as Array<{ providerMessageId: string }>).map(s => s.providerMessageId),
    ]));
    expect(byTenant.get("tenant-a")).toEqual(["wamid.A1", "wamid.A2"]);
    expect(byTenant.get("tenant-b")).toEqual(["wamid.B1"]);

    await expect(responseJson(response)).resolves.toEqual({ accepted: true, statusCount: 3, updatedCount: 3, unresolvedCount: 0 });
  });

  it("resolves a repeated wamid only once per request", async () => {
    persistence.resolveWhatsAppDeliveryTenantId.mockResolvedValue("tenant-a");
    await POST(signedRequest(payload(SHARED, [
      { id: "wamid.A1", status: "sent" },
      { id: "wamid.A1", status: "delivered" },
    ])));
    expect(persistence.resolveWhatsAppDeliveryTenantId).toHaveBeenCalledTimes(1);
    expect(persistence.applyWhatsAppWebhookStatuses).toHaveBeenCalledTimes(1);
  });

  it("does not apply or fall back to the W11.6 resolver when a shared-sender wamid is unresolved", async () => {
    persistence.resolveWhatsAppDeliveryTenantId.mockResolvedValue(null);
    persistence.resolveWhatsAppTenantId.mockResolvedValue("pilot-tenant");
    const wamid = "wamid.HBgMOTA1NTUxMjM0NTY3FQIAERgSQUJDREVGMTIzNDU2Nzg5MAA=";

    const response = await POST(signedRequest(payload(SHARED, [{ id: wamid, status: "failed" }])));

    expect(response.status).toBe(200);
    expect(persistence.resolveWhatsAppTenantId).not.toHaveBeenCalled();
    expect(persistence.applyWhatsAppWebhookStatuses).not.toHaveBeenCalled();
    await expect(responseJson(response)).resolves.toEqual({ accepted: true, statusCount: 1, updatedCount: 0, unresolvedCount: 1 });

    expect(logInfo).toHaveBeenCalledTimes(1);
    const [event, context] = logInfo.mock.calls[0];
    expect(event).toBe("whatsapp_webhook_status_unresolved");
    expect(JSON.stringify(context)).not.toContain(wamid);
    expect(context).toMatchObject({ sharedSenderUnresolved: 1, integrationUnresolved: 0 });
  });

  it("applies resolved shared statuses and counts only the unresolved ones", async () => {
    persistence.resolveWhatsAppDeliveryTenantId.mockImplementation(async (_prisma: unknown, wamid: string) =>
      wamid === "wamid.known" ? "tenant-a" : null);

    const response = await POST(signedRequest(payload(SHARED, [
      { id: "wamid.known", status: "delivered" },
      { id: "wamid.unknown", status: "delivered" },
    ])));

    expect(persistence.applyWhatsAppWebhookStatuses).toHaveBeenCalledTimes(1);
    expect(persistence.applyWhatsAppWebhookStatuses.mock.calls[0][2]).toEqual([
      { phoneNumberId: SHARED, providerMessageId: "wamid.known", status: "delivered" },
    ]);
    await expect(responseJson(response)).resolves.toMatchObject({ updatedCount: 1, unresolvedCount: 1 });
  });

  it("routes non-shared phone numbers through the W11.6 integration resolver", async () => {
    persistence.resolveWhatsAppTenantId.mockResolvedValue("tenant-c");

    const response = await POST(signedRequest(payload("tenant-own-phone", [
      { id: "wamid.C1", status: "delivered" },
      { id: "wamid.C2", status: "sent" },
    ])));

    expect(response.status).toBe(200);
    expect(persistence.resolveWhatsAppDeliveryTenantId).not.toHaveBeenCalled();
    expect(persistence.resolveWhatsAppTenantId).toHaveBeenCalledTimes(1);
    expect(persistence.resolveWhatsAppTenantId.mock.calls[0][1]).toBe("tenant-own-phone");
    expect(persistence.applyWhatsAppWebhookStatuses).toHaveBeenCalledTimes(1);
    expect(persistence.applyWhatsAppWebhookStatuses.mock.calls[0][1]).toEqual({ tenantId: "tenant-c" });
  });

  it("counts W11.6 statuses as unresolved when the phone number has no integration", async () => {
    persistence.resolveWhatsAppTenantId.mockResolvedValue(null);

    const response = await POST(signedRequest(payload("unknown-phone", [{ id: "wamid.X", status: "delivered" }])));

    expect(response.status).toBe(200);
    expect(persistence.applyWhatsAppWebhookStatuses).not.toHaveBeenCalled();
    await expect(responseJson(response)).resolves.toMatchObject({ unresolvedCount: 1, updatedCount: 0 });
  });

  it("uses only the W11.6 path when no shared sender is configured", async () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    persistence.resolveWhatsAppTenantId.mockResolvedValue("tenant-a");

    await POST(signedRequest(payload(SHARED, [{ id: "wamid.A1", status: "delivered" }])));

    expect(persistence.resolveWhatsAppDeliveryTenantId).not.toHaveBeenCalled();
    expect(persistence.resolveWhatsAppTenantId).toHaveBeenCalledTimes(1);
  });
});
