export class NotificationProviderError extends Error {
  constructor(
    readonly errorCode: string,
    readonly outcome: "rejected" | "unknown",
    message = errorCode,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}

export type NotificationEventType = "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_REJECTED" | "APPOINTMENT_RESCHEDULED";

/**
 * Part of the delivery idempotency key. One-off events use the empty key; a repeatable event
 * (APPOINTMENT_RESCHEDULED) passes one key per occurrence so each occurrence is deliverable once.
 */
export const DEFAULT_NOTIFICATION_EVENT_KEY = "";
export type NotificationChannel = "WHATSAPP" | "WEB_PUSH" | "SMS";

/**
 * Templates that may go out as SMS (owner decision 2026-11-07, limited credits): customer
 * messages for confirmed / rejected / rescheduled only. Staff/admin templates and
 * "appointment-created-customer" are never sent as SMS.
 */
export const SMS_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "appointment-confirmed-customer",
  "appointment-rejected-customer",
  "appointment-rescheduled-customer",
]);

const SMS_CHARACTER_MAP: Readonly<Record<string, string>> = {
  "ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G", "ç": "c", "Ç": "C",
  "ö": "o", "Ö": "O", "ü": "u", "Ü": "U", "—": "-", "–": "-", "‘": "'", "’": "'",
  "“": "\"", "”": "\"", "`": "'", "…": "...",
};

/**
 * Plain-ASCII SMS text (owner decision 2026-11-07). Any Turkish or other non-GSM character
 * switches an SMS to UCS-2 (70 chars per segment instead of 160), doubling the credit cost.
 */
export function toSmsText(text: string): string {
  const mapped = Array.from(text, (character) => SMS_CHARACTER_MAP[character] ?? character).join("");
  return mapped
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
export type NotificationDeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "UNKNOWN";

export type NotificationRecipient = Readonly<{
  profileId: string;
  displayName: string;
  phone: string | null;
  templateKey: string;
  body: string;
  templateParameters: ReadonlyArray<string>;
}>;

/** Digits-only phone key used for internal-recipient phone dedupe. Returns null when no digits remain. */
export function phoneDedupeKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Builds the APPOINTMENT_CREATED recipient list: staff, customer, then admins.
 * Staff and customer are always kept unchanged. An admin is skipped when their
 * profileId is already present, or when their digits-only phone key matches the
 * staff phone or an earlier admin's. The customer phone is never used for phone dedupe.
 * WP-10: `customer` is null when the booking has no active WhatsApp opt-in (no customer delivery).
 */
export function dedupeRecipients(input: Readonly<{
  staff: NotificationRecipient;
  customer: NotificationRecipient | null;
  admins: ReadonlyArray<NotificationRecipient>;
}>): ReadonlyArray<NotificationRecipient> {
  const result: NotificationRecipient[] = input.customer ? [input.staff, input.customer] : [input.staff];
  const profileIds = new Set<string>(input.customer ? [input.staff.profileId, input.customer.profileId] : [input.staff.profileId]);
  const internalPhoneKeys = new Set<string>();
  const staffKey = phoneDedupeKey(input.staff.phone);
  if (staffKey) internalPhoneKeys.add(staffKey);

  for (const admin of input.admins) {
    if (profileIds.has(admin.profileId)) continue;
    const key = phoneDedupeKey(admin.phone);
    if (key && internalPhoneKeys.has(key)) continue;
    profileIds.add(admin.profileId);
    if (key) internalPhoneKeys.add(key);
    result.push(admin);
  }
  return result;
}
