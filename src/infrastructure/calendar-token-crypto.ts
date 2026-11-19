import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ADR-045 phase B: Google refresh tokens at rest (AES-256-GCM) and the signed OAuth `state`.
// Key: env CALENDAR_TOKEN_KEY, 32 random bytes as base64/base64url. Never logged.

const VERSION = "v1";

export function readCalendarTokenKey(env: Readonly<Record<string, string | undefined>> = process.env): Buffer | null {
  const raw = env.CALENDAR_TOKEN_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return key.length === 32 ? key : null;
}

/** "v1.<iv>.<ciphertext>.<tag>" (base64url); matches the DB CHECK on refreshTokenEnc. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** Plain text, or null when the value is malformed, was made with another key, or was tampered with. */
export function decryptSecret(value: string, key: Buffer): string | null {
  const [version, iv, body, tag] = value.split(".");
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** OAuth state: "<payload b64url>.<hmac>" binding tenant, profile, a nonce (cookie) and an expiry. */
export type OAuthState = Readonly<{ tenantId: string; profileId: string; nonce: string; expiresAt: number; returnTo: string }>;

export function signOAuthState(state: OAuthState, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update(`oauth-state.${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyOAuthState(value: string, key: Buffer, now: number): OAuthState | null {
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", key).update(`oauth-state.${payload}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof state.tenantId !== "string" || typeof state.profileId !== "string" || typeof state.nonce !== "string") return null;
    if (typeof state.expiresAt !== "number" || state.expiresAt < now) return null;
    if (typeof state.returnTo !== "string" || !/^\/(admin|staff)\/settings\/takvim$/.test(state.returnTo)) return null;
    return state;
  } catch {
    return null;
  }
}
