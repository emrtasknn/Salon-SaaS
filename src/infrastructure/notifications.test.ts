import { describe, expect, it, vi } from "vitest";
import { createMetaWhatsAppProvider } from "./notifications";

describe("Meta WhatsApp provider", () => {
  it("sends an approved template with body parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { "appointment-confirmed-customer": { name: "appointment_confirmed", languageCode: "tr" } },
      fetchImpl,
    });

    const result = await provider.send({
      to: "+905551112233",
      body: "ignored by Meta template transport",
      templateKey: "appointment-confirmed-customer",
      templateParameters: ["Saç Kesimi", "06.10.2026 14:00", "Ayşe"],
    });

    expect(result).toEqual({ providerMessageId: "wamid.1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: "whatsapp",
      to: "+905551112233",
      type: "template",
      template: {
        name: "appointment_confirmed",
        language: { code: "tr" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Saç Kesimi" }, { type: "text", text: "06.10.2026 14:00" }, { type: "text", text: "Ayşe" }] }],
      },
    });
  });

  it("fails closed when a template is not configured", async () => {
    const fetchImpl = vi.fn();
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: {},
      fetchImpl,
    });
    await expect(provider.send({ to: "+1", body: "x", templateKey: "missing", templateParameters: [] }))
      .rejects.toThrow("WHATSAPP_TEMPLATE_NOT_CONFIGURED:missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces provider HTTP failure without exposing credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid token", { status: 401 }));
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret-token",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { x: { name: "x", languageCode: "tr" } },
      fetchImpl,
    });
    await expect(provider.send({ to: "+1", body: "x", templateKey: "x", templateParameters: [] }))
      .rejects.toThrow("WHATSAPP_PROVIDER_HTTP_401:invalid token");
  });
});
