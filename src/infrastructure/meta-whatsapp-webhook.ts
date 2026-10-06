import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaWebhookSignature(input: Readonly<{
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}>): boolean {
  if (!input.signatureHeader?.startsWith("sha256=") || !input.appSecret) return false;
  const received = input.signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", input.appSecret).update(input.rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export type MetaWebhookStatus = Readonly<{
  phoneNumberId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "failed" | "read";
  errorCode?: string;
}>;

export function parseMetaWebhookStatuses(payload: unknown): ReadonlyArray<MetaWebhookStatus> {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const statuses: MetaWebhookStatus[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const metadata = (value as { metadata?: unknown }).metadata;
      if (!metadata || typeof metadata !== "object") continue;
      const phoneNumberId = (metadata as { phone_number_id?: unknown }).phone_number_id;
      if (typeof phoneNumberId !== "string" || !phoneNumberId) continue;
      const rawStatuses = (value as { statuses?: unknown }).statuses;
      if (!Array.isArray(rawStatuses)) continue;
      for (const raw of rawStatuses) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as { id?: unknown; status?: unknown; errors?: unknown };
        if (typeof item.id !== "string") continue;
        if (item.status !== "sent" && item.status !== "delivered" && item.status !== "failed" && item.status !== "read") continue;
        const firstError = Array.isArray(item.errors) ? item.errors[0] : undefined;
        const errorCode = firstError && typeof firstError === "object" && typeof (firstError as { code?: unknown }).code === "number"
          ? String((firstError as { code: number }).code)
          : undefined;
        statuses.push({ phoneNumberId, providerMessageId: item.id, status: item.status, ...(errorCode ? { errorCode } : {}) });
      }
    }
  }
  return statuses;
}
