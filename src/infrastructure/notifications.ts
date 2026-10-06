import type { NotificationChannel } from "../domain/notification";

export type NotificationProvider = Readonly<{
  channel: NotificationChannel;
  send(input: Readonly<{ to: string; body: string; templateKey: string }>): Promise<Readonly<{ providerMessageId: string }>>;
}>;

export function createMockWhatsAppProvider(log: Array<Readonly<{ to: string; body: string; templateKey: string }>>): NotificationProvider {
  return {
    channel: "WHATSAPP",
    async send(input) {
      log.push(Object.freeze({ ...input }));
      return { providerMessageId: `mock-${log.length}` };
    },
  };
}
