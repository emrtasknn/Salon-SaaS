import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebPushProvider } from "./web-push-provider";

const config = { publicKey: `B${"a".repeat(86)}`, privateKey: "c".repeat(43), subject: "mailto:ops@example.com" };
const subscription = { endpoint: "https://push.example.com/secret-device-id", p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) };

afterEach(() => vi.restoreAllMocks());

function statusError(statusCode: number) {
  return Object.assign(new Error("Received unexpected response code"), { statusCode });
}

describe("web push provider (WP-09)", () => {
  it("sends with TTL 24h, the requested urgency, 5s timeout and VAPID details", async () => {
    const sendNotification = vi.fn().mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const provider = createWebPushProvider(config, { sendNotification: sendNotification as never });
    await expect(provider.send(subscription, "{}", { urgency: "high" })).resolves.toEqual({ kind: "ok" });
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      "{}",
      { TTL: 86400, urgency: "high", timeout: 5000, vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey } },
    );
  });

  it.each([[404, "gone"], [410, "gone"], [429, "transient"], [502, "transient"], [400, "config_error"], [403, "config_error"], [413, "config_error"]] as const)(
    "maps rejected status %i to %s and never throws", async (statusCode, kind) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const provider = createWebPushProvider(config, { sendNotification: vi.fn().mockRejectedValue(statusError(statusCode)) as never });
      await expect(provider.send(subscription, "{}", { urgency: "high" })).resolves.toEqual({ kind });
    });

  it("logs config errors without the endpoint", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = createWebPushProvider(config, { sendNotification: vi.fn().mockRejectedValue(statusError(403)) as never });
    await provider.send(subscription, "{}", { urgency: "high" });
    expect(log).toHaveBeenCalledWith("web_push_config_error", expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-device-id");
  });

  it("treats network errors and timeouts as network outcomes", async () => {
    const network = createWebPushProvider(config, { sendNotification: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNRESET" })) as never });
    await expect(network.send(subscription, "{}", { urgency: "high" })).resolves.toEqual({ kind: "network" });
    const hanging = createWebPushProvider(config, { sendNotification: vi.fn(() => new Promise(() => undefined)) as never, timeoutMs: 10 });
    await expect(hanging.send(subscription, "{}", { urgency: "high" })).resolves.toEqual({ kind: "network" });
  });
});
