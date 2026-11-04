import { createHash, randomBytes } from "node:crypto";
import type { AppointmentStatus } from "./appointment";

// WP-06 / ADR-044 §5: customer status-link token. Only the SHA-256 hash is stored;
// the raw token lives in the link and must never be logged or sent to providers.

const TOKEN_BYTES = 32;
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_VALIDITY_AFTER_END_MS = 7 * 24 * 60 * 60_000;

/** Owner decision (a): customer self-cancel closes 120 minutes before startAt. */
export const CUSTOMER_CANCEL_CUTOFF_MINUTES = 120;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateAppointmentAccessToken(): Readonly<{ token: string; tokenHash: string }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/** Returns the lowercase hex SHA-256 of a well-formed raw token, or null for anything else. */
export function hashAppointmentAccessToken(token: unknown): string | null {
  if (typeof token !== "string" || !RAW_TOKEN.test(token)) return null;
  return sha256Hex(token);
}

export function appointmentAccessTokenExpiry(endAt: Date): Date {
  return new Date(endAt.getTime() + TOKEN_VALIDITY_AFTER_END_MS);
}

export function customerCancelDeadline(startAt: Date): Date {
  return new Date(startAt.getTime() - CUSTOMER_CANCEL_CUTOFF_MINUTES * 60_000);
}

export function canCustomerCancel(status: AppointmentStatus, startAt: Date, now: Date): boolean {
  if (status !== "PENDING" && status !== "CONFIRMED") return false;
  return now.getTime() < customerCancelDeadline(startAt).getTime();
}
