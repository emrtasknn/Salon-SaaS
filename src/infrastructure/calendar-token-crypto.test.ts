import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, readCalendarTokenKey, signOAuthState, verifyOAuthState } from "./calendar-token-crypto";

const key = randomBytes(32);

describe("refresh token encryption", () => {
  it("round-trips and matches the DB format check", () => {
    const value = encryptSecret("1//refresh-token", key);
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decryptSecret(value, key)).toBe("1//refresh-token");
  });
  it("fails closed with another key or a tampered value", () => {
    const value = encryptSecret("secret", key);
    expect(decryptSecret(value, randomBytes(32))).toBeNull();
    const [v, iv, body, tag] = value.split(".");
    expect(decryptSecret([v, iv, body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA"), tag].join("."), key)).toBeNull();
    expect(decryptSecret("garbage", key)).toBeNull();
  });
  it("reads only a 32-byte key", () => {
    expect(readCalendarTokenKey({ CALENDAR_TOKEN_KEY: key.toString("base64") })?.equals(key)).toBe(true);
    expect(readCalendarTokenKey({ CALENDAR_TOKEN_KEY: randomBytes(16).toString("base64") })).toBeNull();
    expect(readCalendarTokenKey({})).toBeNull();
  });
});

describe("OAuth state", () => {
  const state = { tenantId: "t1", profileId: "p1", nonce: "n", expiresAt: 2_000, returnTo: "/staff/settings/takvim" };
  it("verifies its own signature before expiry", () => {
    expect(verifyOAuthState(signOAuthState(state, key), key, 1_000)).toEqual(state);
  });
  it("rejects expiry, another key, a forged payload and an open redirect target", () => {
    const signed = signOAuthState(state, key);
    expect(verifyOAuthState(signed, key, 3_000)).toBeNull();
    expect(verifyOAuthState(signed, randomBytes(32), 1_000)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ ...state, tenantId: "t2" })).toString("base64url") + "." + signed.split(".")[1];
    expect(verifyOAuthState(forged, key, 1_000)).toBeNull();
    expect(verifyOAuthState(signOAuthState({ ...state, returnTo: "https://evil.example" }, key), key, 1_000)).toBeNull();
  });
});
