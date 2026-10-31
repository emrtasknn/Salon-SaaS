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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(consoleError).toHaveBeenCalledWith("whatsapp_template_not_configured", { templateKey: "missing" });
    consoleError.mockRestore();
  });

  it("logs safe Meta fields for HTTP errors without exposing secrets", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            error_subcode: 463,
            type: "OAuthException",
            message: "Invalid token for +905551112233 and user@example.com",
          },
        }),
        { status: 400 },
      ),
    );
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret-token",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { x: { name: "x", languageCode: "tr" } },
      fetchImpl,
    });

    await expect(provider.send({ to: "+1", body: "x", templateKey: "x", templateParameters: [] }))
      .rejects.toThrow("WHATSAPP_PROVIDER_HTTP_400");

    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_http_error", {
      status: 400,
      metaErrorCode: 190,
      metaErrorSubcode: 463,
      errorCode: "WHATSAPP_PROVIDER_HTTP_ERROR",
    });
    const serializedLog = JSON.stringify(consoleError.mock.calls);
    expect(serializedLog).not.toContain("secret-token");
    expect(serializedLog).not.toContain("+905551112233");
    expect(serializedLog).not.toContain("user@example.com");
    expect(serializedLog).not.toContain("Invalid token");
    consoleError.mockRestore();
  });

  it("surfaces provider HTTP failure as a generic code for invalid JSON", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawErrorBody = "invalid token +905551112233 user@example.com secret-token";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(rawErrorBody, { status: 401 }));
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret-token",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { x: { name: "x", languageCode: "tr" } },
      fetchImpl,
    });
    await expect(provider.send({ to: "+1", body: "x", templateKey: "x", templateParameters: [] }))
      .rejects.toThrow("WHATSAPP_PROVIDER_HTTP_401");

    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_http_error", {
      status: 401,
      metaErrorCode: null,
      metaErrorSubcode: null,
      errorCode: "WHATSAPP_PROVIDER_HTTP_ERROR",
    });
    const serializedLog = JSON.stringify(consoleError.mock.calls);
    expect(serializedLog).not.toContain(rawErrorBody);
    expect(serializedLog).not.toContain("secret-token");
    expect(serializedLog).not.toContain("+905551112233");
    expect(serializedLog).not.toContain("user@example.com");
    expect(serializedLog).not.toContain("invalid token");
    consoleError.mockRestore();
  });

  it("logs network errors without exposing credentials", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(
      new TypeError("fetch failed: secret-token +905551112233 user@example.com"),
    );
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { x: { name: "x", languageCode: "tr" } },
      fetchImpl,
    });

    await expect(
      provider.send({ to: "+1", body: "x", templateKey: "x", templateParameters: [] }),
    ).rejects.toThrow("WHATSAPP_PROVIDER_NETWORK_ERROR");

    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_network_error", {
      errorCode: "WHATSAPP_PROVIDER_NETWORK_ERROR",
    });
    const serializedLog = JSON.stringify(consoleError.mock.calls);
    expect(serializedLog).not.toContain("secret-token");
    expect(serializedLog).not.toContain("+905551112233");
    expect(serializedLog).not.toContain("user@example.com");
    expect(serializedLog).not.toContain("fetch failed");
    consoleError.mockRestore();
  });

  it("rejects a successful HTTP response without a provider message ID", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{}] }), { status: 200 }));
    const provider = createMetaWhatsAppProvider({
      accessToken: "secret",
      phoneNumberId: "123",
      apiVersion: "v23.0",
      templates: { x: { name: "x", languageCode: "tr" } },
      fetchImpl,
    });

    await expect(
      provider.send({ to: "+1", body: "x", templateKey: "x", templateParameters: [] }),
    ).rejects.toThrow("WHATSAPP_PROVIDER_MESSAGE_ID_MISSING");

    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_message_id_missing", {
      hasMessages: true,
    });
    consoleError.mockRestore();
  });
});
