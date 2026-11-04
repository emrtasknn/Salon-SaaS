import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CANCEL_CUTOFF_MINUTES,
  appointmentAccessTokenExpiry,
  canCustomerCancel,
  customerCancelDeadline,
  generateAppointmentAccessToken,
  hashAppointmentAccessToken,
} from "./appointment-access-token";

describe("appointment access token", () => {
  it("generates a 43-char base64url token and its lowercase sha256 hex hash", () => {
    const { token, tokenHash } = generateAppointmentAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashAppointmentAccessToken(token)).toBe(tokenHash);
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateAppointmentAccessToken().token));
    expect(tokens.size).toBe(50);
  });

  it.each([
    undefined, null, 42, "", "short", "a".repeat(42), "a".repeat(44),
    `${"a".repeat(42)}=`, `${"a".repeat(42)}+`, `${"a".repeat(42)}/`, ` ${"a".repeat(42)}`, "0".repeat(64),
  ])("rejects malformed token %j", (token) => {
    expect(hashAppointmentAccessToken(token)).toBeNull();
  });

  it("expires 7 days after the appointment end", () => {
    expect(appointmentAccessTokenExpiry(new Date("2026-11-05T10:30:00.000Z")).toISOString())
      .toBe("2026-11-12T10:30:00.000Z");
  });

  it("allows customer cancel only for PENDING/CONFIRMED strictly before startAt - 120 min", () => {
    expect(CUSTOMER_CANCEL_CUTOFF_MINUTES).toBe(120);
    const startAt = new Date("2026-11-05T10:00:00.000Z");
    const deadline = customerCancelDeadline(startAt);
    expect(deadline.toISOString()).toBe("2026-11-05T08:00:00.000Z");
    const before = new Date(deadline.getTime() - 1);
    expect(canCustomerCancel("PENDING", startAt, before)).toBe(true);
    expect(canCustomerCancel("CONFIRMED", startAt, before)).toBe(true);
    expect(canCustomerCancel("CONFIRMED", startAt, deadline)).toBe(false);
    expect(canCustomerCancel("PENDING", startAt, new Date(deadline.getTime() + 1))).toBe(false);
    for (const status of ["REJECTED", "CANCELLED", "COMPLETED"] as const) {
      expect(canCustomerCancel(status, startAt, before)).toBe(false);
    }
  });
});
