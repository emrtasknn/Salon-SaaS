import type { NotificationChannel } from "../domain/notification";

export type NotificationProvider = Readonly<{
  channel: NotificationChannel;
  send(input: Readonly<{
    to: string;
    body: string;
    templateKey: string;
    templateParameters: ReadonlyArray<string>;
  }>): Promise<Readonly<{ providerMessageId: string }>>;
}>;

export function createMockWhatsAppProvider(log: Array<Readonly<{ to: string; body: string; templateKey: string; templateParameters: ReadonlyArray<string> }>>): NotificationProvider {
  return {
    channel: "WHATSAPP",
    async send(input) {
      log.push(Object.freeze({ ...input, templateParameters: [...input.templateParameters] }));
      return { providerMessageId: `mock-${log.length}` };
    },
  };
}

export type MetaWhatsAppTemplate = Readonly<{
  name: string;
  languageCode: string;
}>;

export type MetaWhatsAppProviderConfig = Readonly<{
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  templates: Readonly<Record<string, MetaWhatsAppTemplate>>;
  fetchImpl?: typeof fetch;
}>;

type MetaSendResponse = Readonly<{ messages?: ReadonlyArray<Readonly<{ id?: unknown }>> }>;

function safeParseMetaError(raw: string) {
  try {
    const json = JSON.parse(raw);
    const e = json?.error ?? {};
    return {
      code: typeof e.code === "number" ? e.code : null,
      error_subcode: typeof e.error_subcode === "number" ? e.error_subcode : null,
    };
  } catch {
    return null;
  }
}

export function createMetaWhatsAppProvider(config: MetaWhatsAppProviderConfig): NotificationProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    channel: "WHATSAPP",
    async send(input) {
      const template = config.templates[input.templateKey];
      if (!template) {
        console.error("whatsapp_template_not_configured", { templateKey: input.templateKey });
        throw new Error(`WHATSAPP_TEMPLATE_NOT_CONFIGURED:${input.templateKey}`);
      }

      const url = `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`;
      const init = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.languageCode },
            ...(input.templateParameters.length > 0
              ? { components: [{ type: "body", parameters: input.templateParameters.map(text => ({ type: "text", text })) }] }
              : {}),
          },
        }),
      };

      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch {
        console.error("whatsapp_provider_network_error", {
          errorCode: "WHATSAPP_PROVIDER_NETWORK_ERROR",
        });
        throw new Error("WHATSAPP_PROVIDER_NETWORK_ERROR");
      }

      const raw = await response.text().catch(() => "");
      if (!response.ok) {
        const metaError = safeParseMetaError(raw);
        console.error("whatsapp_provider_http_error", {
          status: response.status,
          metaErrorCode: metaError?.code ?? null,
          metaErrorSubcode: metaError?.error_subcode ?? null,
          errorCode: "WHATSAPP_PROVIDER_HTTP_ERROR",
        });
        throw new Error(`WHATSAPP_PROVIDER_HTTP_${response.status}`);
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      const payload = json as MetaSendResponse | null;
      const providerMessageId = payload?.messages?.[0]?.id;
      if (typeof providerMessageId !== "string" || providerMessageId.trim().length === 0) {
        console.error("whatsapp_provider_message_id_missing", {
          hasMessages: Array.isArray(payload?.messages),
          hasValidMessageId: false,
        });
        throw new Error("WHATSAPP_PROVIDER_MESSAGE_ID_MISSING");
      }
      return { providerMessageId };
    },
  };
}
