import { describe, expect, it, vi } from "vitest";
import { NotificationProviderError } from "../domain/notification";
import { createTwilioSmsProvider, readTwilioSmsConfig } from "./twilio-sms";

const input = { to: "+905550000003", body: "Randevunuz onaylandi.", templateKey: "appointment-confirmed-customer", templateParameters: [] };

function response(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("Twilio SMS provider", () => {
  it("posts a form-encoded message with basic auth and returns the message SID", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(201, { sid: "SM123" }));
    const provider = createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "token", sender: { from: "+15550001111" }, fetchImpl });

    await expect(provider.send(input)).resolves.toEqual({ providerMessageId: "SM123" });
    expect(provider.channel).toBe("SMS");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("AC1:token").toString("base64")}`);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({ To: "+905550000003", Body: "Randevunuz onaylandi.", From: "+15550001111" });
  });

  it("uses MessagingServiceSid instead of From when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(201, { sid: "SM1" }));
    await createTwilioSmsProvider({ accountSid: "AC1", username: "SK1", password: "secret", sender: { messagingServiceSid: "MG1" }, fetchImpl }).send(input);
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(form.get("MessagingServiceSid")).toBe("MG1");
    expect(form.has("From")).toBe(false);
  });

  it("treats a 4xx as rejected and keeps Twilio's error code (e.g. trial + unverified number)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(400, { code: 21608, message: "The number +905550000003 is unverified." }));
    const error = await createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "t", sender: { from: "+1" }, fetchImpl }).send(input).catch((e) => e);
    expect(error).toBeInstanceOf(NotificationProviderError);
    expect(error).toMatchObject({ errorCode: "TWILIO_21608", outcome: "rejected" });
  });

  it.each([[500], [503], [408]])("treats HTTP %i as an unknown outcome", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(status, "oops"));
    await expect(createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "t", sender: { from: "+1" }, fetchImpl }).send(input))
      .rejects.toMatchObject({ errorCode: `SMS_PROVIDER_HTTP_${status}`, outcome: "unknown" });
  });

  it("treats a network error and a missing SID as unknown", async () => {
    const network = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "t", sender: { from: "+1" }, fetchImpl: network }).send(input))
      .rejects.toMatchObject({ errorCode: "SMS_PROVIDER_NETWORK_ERROR", outcome: "unknown" });
    const noSid = vi.fn().mockResolvedValue(response(201, { status: "queued" }));
    await expect(createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "t", sender: { from: "+1" }, fetchImpl: noSid }).send(input))
      .rejects.toMatchObject({ errorCode: "SMS_PROVIDER_MESSAGE_ID_MISSING", outcome: "unknown" });
  });

  it("never logs the phone number or the response body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(response(400, { code: 21211, message: "Invalid 'To' Phone Number: +905550000003" }));
    await createTwilioSmsProvider({ accountSid: "AC1", username: "AC1", password: "t", sender: { from: "+1" }, fetchImpl }).send(input).catch(() => {});
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).not.toContain("905550000003");
    expect(logged).not.toContain("Invalid");
  });
});

describe("readTwilioSmsConfig", () => {
  it("is null (SMS off) unless account SID, a credential pair and a sender are all set", () => {
    expect(readTwilioSmsConfig({})).toBeNull();
    expect(readTwilioSmsConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" })).toBeNull();
    expect(readTwilioSmsConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_FROM_NUMBER: "+1" })).toBeNull();
    expect(readTwilioSmsConfig({ TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" })).toBeNull();
    expect(readTwilioSmsConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK1", TWILIO_FROM_NUMBER: "+1" })).toBeNull();
    expect(readTwilioSmsConfig({ TWILIO_ACCOUNT_SID: " ", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" })).toBeNull();
  });

  it("uses account SID + auth token as basic auth", () => {
    expect(readTwilioSmsConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111" }))
      .toEqual({ accountSid: "AC1", username: "AC1", password: "tok", sender: { from: "+15550001111" } });
  });

  it("prefers an API key pair and a messaging service when both are set", () => {
    expect(readTwilioSmsConfig({
      TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec",
      TWILIO_FROM_NUMBER: "+1", TWILIO_MESSAGING_SERVICE_SID: "MG1",
    })).toEqual({ accountSid: "AC1", username: "SK1", password: "sec", sender: { messagingServiceSid: "MG1" } });
  });
});
