// WP-10: per-appointment contact snapshot (AppointmentContact). Customer WhatsApp is allowed only
// with an opt-in record that was not withdrawn; Profile.phone is never a fallback.

export type WhatsAppConsentState = "NONE" | "OPTED_IN" | "OPTED_OUT";

export type AppointmentContactConsent = Readonly<{ whatsappOptIn: boolean; optOutAt: Date | null }>;

/** Read-only contact snapshot shown to staff/admin (may differ from the CRM profile). */
export type BookingContact = Readonly<{
  displayName: string;
  phone: string | null;
  email: string | null;
  whatsapp: WhatsAppConsentState;
}>;

export function whatsAppStateOf(contact: AppointmentContactConsent | null | undefined): WhatsAppConsentState {
  if (!contact || !contact.whatsappOptIn) return "NONE";
  return contact.optOutAt === null ? "OPTED_IN" : "OPTED_OUT";
}

export function toBookingContact(
  contact: (AppointmentContactConsent & { displayName: string; phone: string | null; email: string | null }) | null | undefined,
): BookingContact | null {
  if (!contact) return null;
  return { displayName: contact.displayName, phone: contact.phone, email: contact.email, whatsapp: whatsAppStateOf(contact) };
}
