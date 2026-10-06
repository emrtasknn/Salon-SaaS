import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    status: number;
    body: string;
    constructor(body: string, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200; }
    static json(value: unknown) { return { status: 200, json: async () => value }; }
  },
}));

import { GET, POST } from "./route";

describe("WhatsApp webhook route", () => {
  it("rejects invalid verification token", async () => {
    const response = await GET(new Request("https://example.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=x"));
    expect(response.status).toBe(403);
  });

  it("rejects invalid webhook signature", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
    const request = new Request("https://example.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=bad" },
      body: '{"entry":[]}',
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });
});
