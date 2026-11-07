import { NotificationProviderError } from "../domain/notification";
import type { NotificationProvider } from "./notifications";
import { logError } from "./log-redaction";

/**
 * Twilio Programmable Messaging (customer SMS, owner decision 2026-11-07).
 * Auth is either Account SID + Auth Token, or an API Key SID + secret (username/password
 * below). The sender is a Messaging Service SID or a Twilio phone number.
 */
export type TwilioSmsProviderConfig = Readonly<{
  accountSid: string;
  username: string;
  password: string;
  sender: Readonly<{ messagingServiceSid: string } | { from: string }>;
  fetchImpl?: typeof fetch;
}>;

type TwilioMessageResponse = Readonly<{ sid?: unknown }>;

function twilioErrorCode(raw: string): number | null {
  try {
    const json = JSON.parse(raw) as { code?: unknown } | null;
    return typeof json?.code === "number" ? json.code : null;
  } catch {
    return null;
  }
}

export function createTwilioSmsProvider(config: TwilioSmsProviderConfig): NotificationProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`;

  return {
    channel: "SMS",
    async send(input) {
      const form = new URLSearchParams({ To: input.to, Body: input.body });
      if ("messagingServiceSid" in config.sender) form.set("MessagingServiceSid", config.sender.messagingServiceSid);
      else form.set("From", config.sender.from);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
      } catch {
        logError("sms_provider_network_error", { errorCode: "SMS_PROVIDER_NETWORK_ERROR" });
        throw new NotificationProviderError("SMS_PROVIDER_NETWORK_ERROR", "unknown");
      }

      const raw = await response.text().catch(() => "");
      if (!response.ok) {
        // Twilio's numeric code (e.g. 21608: trial account, unverified recipient) is safe to keep;
        // the response body may echo the phone number, so it is never logged.
        const code = twilioErrorCode(raw);
        logError("sms_provider_http_error", { status: response.status, twilioErrorCode: code, errorCode: "SMS_PROVIDER_HTTP_ERROR" });
        // 4xx (except 408 timeout) means Twilio did not accept the message: safe to mark FAILED.
        const outcome = response.status >= 400 && response.status < 500 && response.status !== 408 ? "rejected" : "unknown";
        throw new NotificationProviderError(code !== null ? `TWILIO_${code}` : `SMS_PROVIDER_HTTP_${response.status}`, outcome);
      }

      let payload: TwilioMessageResponse | null;
      try {
        payload = JSON.parse(raw) as TwilioMessageResponse | null;
      } catch {
        payload = null;
      }
      const sid = payload?.sid;
      if (typeof sid !== "string" || sid.trim().length === 0) {
        logError("sms_provider_message_id_missing", { errorCode: "SMS_PROVIDER_MESSAGE_ID_MISSING" });
        throw new NotificationProviderError("SMS_PROVIDER_MESSAGE_ID_MISSING", "unknown");
      }
      return { providerMessageId: sid };
    },
  };
}

type TwilioEnv = Readonly<Record<string, string | undefined>>;

/**
 * Reads the Twilio config from server env. Returns null (SMS off) unless the account SID,
 * one credential pair and one sender are all set. Values are never logged.
 */
export function readTwilioSmsConfig(env: TwilioEnv): Omit<TwilioSmsProviderConfig, "fetchImpl"> | null {
  const value = (name: string) => {
    const raw = env[name]?.trim();
    return raw ? raw : null;
  };
  const accountSid = value("TWILIO_ACCOUNT_SID");
  if (!accountSid) return null;

  const apiKeySid = value("TWILIO_API_KEY_SID");
  const apiKeySecret = value("TWILIO_API_KEY_SECRET");
  const authToken = value("TWILIO_AUTH_TOKEN");
  const credentials = apiKeySid && apiKeySecret
    ? { username: apiKeySid, password: apiKeySecret }
    : authToken
      ? { username: accountSid, password: authToken }
      : null;
  if (!credentials) return null;

  const messagingServiceSid = value("TWILIO_MESSAGING_SERVICE_SID");
  const from = value("TWILIO_FROM_NUMBER");
  const sender = messagingServiceSid ? { messagingServiceSid } : from ? { from } : null;
  if (!sender) return null;

  return { accountSid, ...credentials, sender };
}
