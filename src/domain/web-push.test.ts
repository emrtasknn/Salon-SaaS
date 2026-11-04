import { describe, expect, it } from "vitest";
import {
  aggregatePushOutcomes,
  buildAppointmentCreatedPushPayload,
  classifyWebPushError,
  classifyWebPushStatus,
  readVapidConfig,
  selectPushRecipients,
  shouldRevokeAfterFailures,
  subscriptionUpdateFor,
  validatePushSubscriptionInput,
  WEB_PUSH_MAX_PAYLOAD_BYTES,
} from "./web-push";

const P256DH = `B${"a".repeat(86)}`;
const AUTH = "b".repeat(22);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

describe("buildAppointmentCreatedPushPayload", () => {
  const base = { appointmentId: "appt-1", serviceName: "Saç kesimi", startAt: new Date("2026-11-05T10:00:00Z"), timeZone: "Europe/Istanbul" };

  it("builds the v1 contract with a role-specific deep link", () => {
    const staff = JSON.parse(buildAppointmentCreatedPushPayload({ ...base, role: "STAFF" }));
    expect(staff).toEqual({
      v: 1,
      type: "APPOINTMENT_CREATED",
      title: "Yeni randevu talebi",
      body: expect.stringMatching(/^Saç kesimi — 0?5\.11\.2026 13:00$/),
      url: "/staff/appointments",
      tag: "appt-appt-1",
    });
    const admin = JSON.parse(buildAppointmentCreatedPushPayload({ ...base, role: "TENANT_ADMIN" }));
    expect(admin.url).toBe("/admin/calendar");
  });

  it("has only the contract keys (no customer name/phone/email field)", () => {
    const payload = JSON.parse(buildAppointmentCreatedPushPayload({ ...base, role: "STAFF" }));
    expect(Object.keys(payload).sort()).toEqual(["body", "tag", "title", "type", "url", "v"]);
    const raw = buildAppointmentCreatedPushPayload({ ...base, role: "STAFF" });
    expect(raw).not.toMatch(/@|\+90|customer|phone|email/i);
  });

  it("stays within 1 KB even with a very long service name", () => {
    const raw = buildAppointmentCreatedPushPayload({ ...base, serviceName: "Ğ".repeat(5000), role: "TENANT_ADMIN" });
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(WEB_PUSH_MAX_PAYLOAD_BYTES);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("validatePushSubscriptionInput", () => {
  const valid = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };

  it("accepts a valid subscription and strips '=' padding", () => {
    expect(validatePushSubscriptionInput({ ...valid, keys: { p256dh: `${P256DH}=`, auth: `${AUTH}==` } }))
      .toEqual({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, userAgent: null });
  });

  it("truncates userAgent to 256 chars", () => {
    expect(validatePushSubscriptionInput({ ...valid, userAgent: "x".repeat(400) })?.userAgent).toHaveLength(256);
  });

  it.each([
    ["http endpoint", { ...valid, endpoint: "http://push.example.com/x" }],
    ["non-URL endpoint", { ...valid, endpoint: "https://" }],
    ["endpoint > 2048", { ...valid, endpoint: `https://push.example.com/${"a".repeat(2048)}` }],
    ["credentials in endpoint", { ...valid, endpoint: "https://u:p@push.example.com/x" }],
    ["p256dh 86 chars", { ...valid, keys: { p256dh: `B${"a".repeat(85)}`, auth: AUTH } }],
    ["p256dh 88 chars", { ...valid, keys: { p256dh: `B${"a".repeat(87)}`, auth: AUTH } }],
    ["p256dh not starting with B", { ...valid, keys: { p256dh: `A${"a".repeat(86)}`, auth: AUTH } }],
    ["auth 21 chars", { ...valid, keys: { p256dh: P256DH, auth: "b".repeat(21) } }],
    ["auth 23 chars", { ...valid, keys: { p256dh: P256DH, auth: "b".repeat(23) } }],
    ["auth with '+'", { ...valid, keys: { p256dh: P256DH, auth: `${"b".repeat(21)}+` } }],
    ["missing keys", { endpoint: ENDPOINT }],
    ["non-string userAgent", { ...valid, userAgent: 42 }],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(validatePushSubscriptionInput(input)).toBeNull();
  });
});

describe("readVapidConfig", () => {
  const env = { WEB_PUSH_VAPID_PUBLIC_KEY: P256DH, WEB_PUSH_VAPID_PRIVATE_KEY: "c".repeat(43), WEB_PUSH_VAPID_SUBJECT: "mailto:ops@example.com" };
  it("accepts mailto: and https: subjects", () => {
    expect(readVapidConfig(env)).toEqual({ publicKey: P256DH, privateKey: "c".repeat(43), subject: "mailto:ops@example.com" });
    expect(readVapidConfig({ ...env, WEB_PUSH_VAPID_SUBJECT: "https://salon.example.com" })).not.toBeNull();
  });
  it.each([
    ["missing", {}],
    ["empty private key", { ...env, WEB_PUSH_VAPID_PRIVATE_KEY: "" }],
    ["bad subject", { ...env, WEB_PUSH_VAPID_SUBJECT: "http://x.example.com" }],
    ["bad public key", { ...env, WEB_PUSH_VAPID_PUBLIC_KEY: "short" }],
  ])("returns null when %s", (_label, input) => {
    expect(readVapidConfig(input)).toBeNull();
  });
});

describe("selectPushRecipients", () => {
  it("routes to active assigned staff plus all admins, deduped", () => {
    expect(selectPushRecipients({
      assignedStaff: { profileId: "s1", status: "ACTIVE", hasMembership: true },
      adminProfileIds: ["a1", "a2", "a1"],
    })).toEqual([
      { profileId: "s1", role: "STAFF" },
      { profileId: "a1", role: "TENANT_ADMIN" },
      { profileId: "a2", role: "TENANT_ADMIN" },
    ]);
  });
  it("skips INACTIVE staff and staff without membership", () => {
    expect(selectPushRecipients({ assignedStaff: { profileId: "s1", status: "INACTIVE", hasMembership: true }, adminProfileIds: ["a1"] }))
      .toEqual([{ profileId: "a1", role: "TENANT_ADMIN" }]);
    expect(selectPushRecipients({ assignedStaff: { profileId: "s1", status: "ACTIVE", hasMembership: false }, adminProfileIds: [] }))
      .toEqual([]);
  });
  it("admin wins over the staff role, including an INACTIVE staff row", () => {
    expect(selectPushRecipients({ assignedStaff: { profileId: "a1", status: "INACTIVE", hasMembership: true }, adminProfileIds: ["a1"] }))
      .toEqual([{ profileId: "a1", role: "TENANT_ADMIN" }]);
  });
});

describe("web push outcome classification", () => {
  it.each([
    [201, "ok"], [200, "ok"], [404, "gone"], [410, "gone"], [429, "transient"], [500, "transient"], [503, "transient"],
    [400, "config_error"], [401, "config_error"], [403, "config_error"], [413, "config_error"],
  ] as const)("status %i -> %s", (status, kind) => {
    expect(classifyWebPushStatus(status)).toBe(kind);
  });

  it("classifies thrown errors", () => {
    expect(classifyWebPushError({ statusCode: 410 })).toBe("gone");
    expect(classifyWebPushError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("network");
    expect(classifyWebPushError(new Error("Socket timeout"))).toBe("network");
    expect(classifyWebPushError(Object.assign(new Error("t"), { name: "WebPushTimeoutError" }))).toBe("network");
    expect(classifyWebPushError(new Error("Vapid private key should be 32 bytes long"))).toBe("config_error");
  });

  it("maps outcomes to subscription updates; config errors never revoke", () => {
    expect(subscriptionUpdateFor("ok")).toBe("reset_failures");
    expect(subscriptionUpdateFor("gone")).toBe("revoke");
    expect(subscriptionUpdateFor("transient")).toBe("count_failure");
    expect(subscriptionUpdateFor("network")).toBe("count_failure");
    expect(subscriptionUpdateFor("config_error")).toBe("none");
    expect(shouldRevokeAfterFailures(4)).toBe(false);
    expect(shouldRevokeAfterFailures(5)).toBe(true);
  });

  it("aggregates device outcomes per recipient", () => {
    expect(aggregatePushOutcomes([{ kind: "ok" }, { kind: "gone" }, { kind: "network" }])).toEqual({ status: "SENT", providerMessageId: "webpush:1/3" });
    expect(aggregatePushOutcomes([{ kind: "gone" }, { kind: "network" }])).toEqual({ status: "UNKNOWN", errorCode: "WEB_PUSH_OUTCOME_UNKNOWN" });
    expect(aggregatePushOutcomes([{ kind: "gone" }, { kind: "transient" }])).toMatchObject({ status: "FAILED" });
    expect(aggregatePushOutcomes([{ kind: "config_error" }])).toEqual({ status: "FAILED", errorCode: "WEB_PUSH_CONFIG_ERROR" });
  });
});
