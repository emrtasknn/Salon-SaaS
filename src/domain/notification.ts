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

export type NotificationEventType = "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_REJECTED";
export type NotificationChannel = "WHATSAPP" | "WEB_PUSH";
export type NotificationDeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "UNKNOWN";

export type NotificationRecipient = Readonly<{
  profileId: string;
  displayName: string;
  phone: string | null;
  templateKey: string;
  body: string;
  templateParameters: ReadonlyArray<string>;
}>;

export function recipientsForEvent(eventType: NotificationEventType, input: Readonly<{
  customer: Readonly<{ profileId: string; displayName: string; phone: string | null }>;
  staff: Readonly<{ profileId: string; displayName: string; phone: string | null }>;
  serviceName: string;
  startAt: Date;
  timeZone: string;
}>): ReadonlyArray<NotificationRecipient> {
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: input.timeZone, dateStyle: "short", timeStyle: "short" }).format(input.startAt);
  const customerBody = eventType === "APPOINTMENT_CONFIRMED"
    ? `Randevunuz onaylandı. ${input.serviceName} — ${time} — ${input.staff.displayName}.`
    : eventType === "APPOINTMENT_REJECTED"
      ? `Randevu talebiniz onaylanmadı. ${input.serviceName} — ${time}.`
      : `Randevu talebiniz oluşturuldu ve onay bekliyor. ${input.serviceName} — ${time}.`;
  if (eventType === "APPOINTMENT_CREATED") {
    return [
      { profileId: input.staff.profileId, displayName: input.staff.displayName, phone: input.staff.phone, templateKey: "appointment-created-staff", body: `Yeni randevu talebi: ${input.customer.displayName} — ${input.serviceName} — ${time}. Onay bekliyor.`, templateParameters: [input.customer.displayName, input.serviceName, time] },
      { profileId: input.customer.profileId, displayName: input.customer.displayName, phone: input.customer.phone, templateKey: "appointment-created-customer", body: customerBody, templateParameters: [input.serviceName, time] },
    ];
  }
  return [{ profileId: input.customer.profileId, displayName: input.customer.displayName, phone: input.customer.phone,
    templateKey: eventType === "APPOINTMENT_CONFIRMED" ? "appointment-confirmed-customer" : "appointment-rejected-customer",
    body: customerBody,
    templateParameters: eventType === "APPOINTMENT_CONFIRMED" ? [input.serviceName, time, input.staff.displayName] : [input.serviceName, time],
  }];
}

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
