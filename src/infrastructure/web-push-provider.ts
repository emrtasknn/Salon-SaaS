import "server-only";
import { sendNotification as webPushSendNotification } from "web-push";
import {
  classifyWebPushError,
  classifyWebPushStatus,
  WEB_PUSH_TIMEOUT_MS,
  WEB_PUSH_TTL_SECONDS,
  type VapidConfig,
  type WebPushOutcome,
  type WebPushSender,
} from "../domain/web-push";
import { logError } from "./log-redaction";

// WP-09: VAPID-signed, RFC 8291-encrypted Web Push via the `web-push` library
// (ADR-044 §4.5). Node runtime only (uses node:https / node:crypto; not Edge).
// Never throws: every device send resolves to a WebPushOutcome.

type SendNotification = typeof webPushSendNotification;

class WebPushTimeoutError extends Error {
  constructor() {
    super("WEB_PUSH_TIMEOUT");
    this.name = "WebPushTimeoutError";
  }
}

export function createWebPushProvider(
  config: VapidConfig,
  dependencies: Readonly<{ sendNotification?: SendNotification; timeoutMs?: number }> = {},
): WebPushSender {
  const sendNotification = dependencies.sendNotification ?? webPushSendNotification;
  const timeoutMs = dependencies.timeoutMs ?? WEB_PUSH_TIMEOUT_MS;
  return {
    async send(subscription, payload, options) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          {
            TTL: WEB_PUSH_TTL_SECONDS,
            urgency: options.urgency,
            timeout: timeoutMs,
            vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          },
        );
        // Wall-clock guard on top of the library's socket timeout.
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new WebPushTimeoutError()), timeoutMs);
        });
        const result = await Promise.race([request, deadline]);
        return outcome(classifyWebPushStatus(result.statusCode), result.statusCode);
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : null;
        return outcome(classifyWebPushError(error), statusCode);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function outcome(kind: WebPushOutcome["kind"], statusCode: number | null): WebPushOutcome {
  if (kind === "config_error") {
    // Bad VAPID keys / oversized payload / malformed request: alert, never revoke.
    // The endpoint is never logged (it is a device capability URL).
    logError("web_push_config_error", { status: statusCode, errorCode: "WEB_PUSH_CONFIG_ERROR" });
  }
  return { kind };
}
