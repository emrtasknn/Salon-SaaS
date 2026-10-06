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

type MetaSendResponse = Readonly<{ messages?: ReadonlyArray<Readonly<{ id?: string }>> }>;

export function createMetaWhatsAppProvider(config: MetaWhatsAppProviderConfig): NotificationProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    channel: "WHATSAPP",
    async send(input) {
      const template = config.templates[input.templateKey];
      if (!template) throw new Error(`WHATSAPP_TEMPLATE_NOT_CONFIGURED:${input.templateKey}`);

      const response = await fetchImpl(
        `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
        {
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
        },
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`WHATSAPP_PROVIDER_HTTP_${response.status}:${errorBody.slice(0, 500)}`);
      }

      const payload = await response.json() as MetaSendResponse;
      const providerMessageId = payload.messages?.[0]?.id;
      if (!providerMessageId) throw new Error("WHATSAPP_PROVIDER_MESSAGE_ID_MISSING");
      return { providerMessageId };
    },
  };
}
