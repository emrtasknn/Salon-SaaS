import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMetaWebhookStatuses, verifyMetaWebhookSignature } from "./meta-whatsapp-webhook";

describe("Meta WhatsApp webhook", () => {
  it("verifies the raw-body HMAC signature", () => {
    const rawBody = '{"entry":[]}';
    const secret = "test-secret";
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    expect(verifyMetaWebhookSignature({ rawBody, signatureHeader: `sha256=${signature}`, appSecret: secret })).toBe(true);
    expect(verifyMetaWebhookSignature({ rawBody, signatureHeader: "sha256=bad", appSecret: secret })).toBe(false);
  });

  it("parses delivery statuses without trusting unrelated fields", () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }, { id: "wamid.2", status: "failed", errors: [{ code: 131026 }] }, { id: 3, status: "delivered" }] } }] }] };
    expect(parseMetaWebhookStatuses(payload)).toEqual([
      { providerMessageId: "wamid.1", status: "delivered" },
      { providerMessageId: "wamid.2", status: "failed", errorCode: "131026" },
    ]);
  });
});
