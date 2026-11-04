// WP-09 / ADR-044 §4: pure Web Push rules (validation, payload, recipient
// selection, provider-outcome classification). No I/O here.

export const WEB_PUSH_TEMPLATE_KEY = "appointment-created-push";
export const WEB_PUSH_TTL_SECONDS = 86_400;
export const WEB_PUSH_TIMEOUT_MS = 5_000;
export const WEB_PUSH_MAX_PAYLOAD_BYTES = 1024;
/** ADR-044 §10-6: revoke a subscription after this many consecutive transient failures. */
export const WEB_PUSH_MAX_TRANSIENT_FAILURES = 5;
/** Upper bound on devices fanned out per recipient (keeps the booking path latency bounded). */
export const WEB_PUSH_MAX_DEVICES_PER_RECIPIENT = 20;

export const WEB_PUSH_ENDPOINT_MAX_LENGTH = 2048;
export const WEB_PUSH_USER_AGENT_MAX_LENGTH = 256;
// Same patterns as the DB CHECKs (migration 20261105130000_web_push_subscription).
const P256DH = /^B[A-Za-z0-9_-]{86}$/;
const AUTH = /^[A-Za-z0-9_-]{22}$/;

export type PushRecipientRole = "STAFF" | "TENANT_ADMIN";
export type WebPushUrgency = "high" | "normal";

export type WebPushSubscriptionKeys = Readonly<{ endpoint: string; p256dh: string; auth: string }>;

/** Result of one device send. Providers return this and never throw. */
export type WebPushOutcome =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "gone" }>
  | Readonly<{ kind: "transient" }>
  | Readonly<{ kind: "network" }>
  | Readonly<{ kind: "config_error" }>;

export type WebPushSender = Readonly<{
  send(subscription: WebPushSubscriptionKeys, payload: string, options: Readonly<{ urgency: WebPushUrgency }>): Promise<WebPushOutcome>;
}>;

export type ValidatedPushSubscription = Readonly<{
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}>;

function stripPadding(value: string): string {
  return value.replace(/=+$/, "");
}

/** Returns the normalized endpoint, or null when it is not an https URL of bounded length. */
export function validatePushEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > WEB_PUSH_ENDPOINT_MAX_LENGTH) return null;
  if (!value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.length === 0 || url.username || url.password) return null;
  } catch {
    return null;
  }
  return value;
}

/** Validates the browser PushSubscription JSON. Never trusts any other client field. */
export function validatePushSubscriptionInput(input: unknown): ValidatedPushSubscription | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  const endpoint = validatePushEndpoint(record.endpoint);
  if (!endpoint) return null;
  const keys = record.keys;
  if (typeof keys !== "object" || keys === null) return null;
  const rawP256dh = (keys as Record<string, unknown>).p256dh;
  const rawAuth = (keys as Record<string, unknown>).auth;
  if (typeof rawP256dh !== "string" || typeof rawAuth !== "string") return null;
  if (rawP256dh.length > 128 || rawAuth.length > 64) return null;
  const p256dh = stripPadding(rawP256dh);
  const auth = stripPadding(rawAuth);
  if (!P256DH.test(p256dh) || !AUTH.test(auth)) return null;
  let userAgent: string | null = null;
  if (record.userAgent !== undefined && record.userAgent !== null) {
    if (typeof record.userAgent !== "string") return null;
    const trimmed = record.userAgent.trim();
    userAgent = trimmed.length === 0 ? null : trimmed.slice(0, WEB_PUSH_USER_AGENT_MAX_LENGTH);
  }
  return Object.freeze({ endpoint, p256dh, auth, userAgent });
}

export type VapidConfig = Readonly<{ publicKey: string; privateKey: string; subject: string }>;

/** Reads VAPID config; null when any value is missing or malformed (channel disabled). */
export function readVapidConfig(env: Readonly<Record<string, string | undefined>>): VapidConfig | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  // 65-byte uncompressed P-256 point / 32-byte private scalar, unpadded base64url.
  if (!P256DH.test(stripPadding(publicKey))) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(stripPadding(privateKey))) return null;
  if (!/^mailto:\S+@\S+$/.test(subject) && !/^https:\/\/\S+$/.test(subject)) return null;
  return Object.freeze({ publicKey: stripPadding(publicKey), privateKey: stripPadding(privateKey), subject });
}

export type PushPayloadInput = Readonly<{
  appointmentId: string;
  serviceName: string;
  startAt: Date;
  timeZone: string;
  role: PushRecipientRole;
}>;

/**
 * APPOINTMENT_CREATED payload. Contains no customer name/phone/email: only the
 * service, the local time and a role-specific relative deep link.
 */
export function buildAppointmentCreatedPushPayload(input: PushPayloadInput): string {
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: input.timeZone, dateStyle: "short", timeStyle: "short" }).format(input.startAt);
  const build = (serviceName: string) => JSON.stringify({
    v: 1,
    type: "APPOINTMENT_CREATED",
    title: "Yeni randevu talebi",
    body: `${serviceName} — ${time}`,
    url: input.role === "TENANT_ADMIN" ? "/admin/calendar" : "/staff/appointments",
    tag: `appt-${input.appointmentId}`,
  });
  let serviceName = input.serviceName.slice(0, 200);
  let payload = build(serviceName);
  while (new TextEncoder().encode(payload).length > WEB_PUSH_MAX_PAYLOAD_BYTES && serviceName.length > 0) {
    serviceName = serviceName.slice(0, Math.max(0, serviceName.length - 16));
    payload = build(serviceName);
  }
  return payload;
}

export type PushRecipient = Readonly<{ profileId: string; role: PushRecipientRole }>;

/**
 * ADR-044 §4.4 / §10-3 send-time routing for APPOINTMENT_CREATED: the assigned
 * staff when Staff.status is ACTIVE and it still has a STAFF|TENANT_ADMIN
 * membership, plus every TENANT_ADMIN. Deduplicated by profile; an admin
 * membership wins over the staff role (and over an INACTIVE staff row).
 */
export function selectPushRecipients(input: Readonly<{
  assignedStaff: Readonly<{ profileId: string; status: "ACTIVE" | "INACTIVE"; hasMembership: boolean }> | null;
  adminProfileIds: ReadonlyArray<string>;
}>): ReadonlyArray<PushRecipient> {
  const admins = new Set(input.adminProfileIds);
  const result: PushRecipient[] = [];
  const seen = new Set<string>();
  const staff = input.assignedStaff;
  if (staff && admins.has(staff.profileId)) {
    result.push({ profileId: staff.profileId, role: "TENANT_ADMIN" });
    seen.add(staff.profileId);
  } else if (staff && staff.status === "ACTIVE" && staff.hasMembership) {
    result.push({ profileId: staff.profileId, role: "STAFF" });
    seen.add(staff.profileId);
  }
  for (const profileId of input.adminProfileIds) {
    if (seen.has(profileId)) continue;
    seen.add(profileId);
    result.push({ profileId, role: "TENANT_ADMIN" });
  }
  return result;
}

/** Push-service HTTP status → outcome (ADR-044 §4.2, §10-6). */
export function classifyWebPushStatus(statusCode: number): WebPushOutcome["kind"] {
  if (statusCode >= 200 && statusCode < 300) return "ok";
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 429 || statusCode >= 500) return "transient";
  // 400/401/403/413 and any other 4xx: our request/VAPID is wrong. Never revoke on these,
  // otherwise one bad VAPID key would wipe every subscription.
  return "config_error";
}

/** Thrown-error → outcome. Errors with a push-service status use the status classifier. */
export function classifyWebPushError(error: unknown): WebPushOutcome["kind"] {
  if (typeof error === "object" && error !== null) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode > 0) return classifyWebPushStatus(statusCode);
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^(E[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(code)) return "network";
    if ((error as { name?: unknown }).name === "WebPushTimeoutError") return "network";
    // web-push destroys the request with a plain Error("Socket timeout") on its socket timeout.
    if ((error as { message?: unknown }).message === "Socket timeout") return "network";
  }
  return "config_error";
}

export type SubscriptionUpdate = "reset_failures" | "revoke" | "count_failure" | "none";

/** What a single device outcome does to its PushSubscription row. */
export function subscriptionUpdateFor(outcome: WebPushOutcome["kind"]): SubscriptionUpdate {
  switch (outcome) {
    case "ok": return "reset_failures";
    case "gone": return "revoke";
    case "transient":
    case "network": return "count_failure";
    default: return "none";
  }
}

export function shouldRevokeAfterFailures(failureCount: number): boolean {
  return failureCount >= WEB_PUSH_MAX_TRANSIENT_FAILURES;
}

export type PushDeliveryOutcome =
  | Readonly<{ status: "SENT"; providerMessageId: string }>
  | Readonly<{ status: "FAILED"; errorCode: string }>
  | Readonly<{ status: "UNKNOWN"; errorCode: string }>;

/** Per-recipient delivery: SENT if ≥1 device accepted, UNKNOWN on ambiguous network errors, else FAILED. */
export function aggregatePushOutcomes(outcomes: ReadonlyArray<WebPushOutcome>): PushDeliveryOutcome {
  const total = outcomes.length;
  const ok = outcomes.filter(outcome => outcome.kind === "ok").length;
  if (ok > 0) return { status: "SENT", providerMessageId: `webpush:${ok}/${total}` };
  if (outcomes.some(outcome => outcome.kind === "network")) return { status: "UNKNOWN", errorCode: "WEB_PUSH_OUTCOME_UNKNOWN" };
  if (outcomes.some(outcome => outcome.kind === "config_error")) return { status: "FAILED", errorCode: "WEB_PUSH_CONFIG_ERROR" };
  if (outcomes.some(outcome => outcome.kind === "transient")) return { status: "FAILED", errorCode: "WEB_PUSH_TRANSIENT_ERROR" };
  return { status: "FAILED", errorCode: "WEB_PUSH_SUBSCRIPTION_GONE" };
}
