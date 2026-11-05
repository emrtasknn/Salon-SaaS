// WP-10: read-only contact snapshot entered for one booking (may differ from the CRM profile).
// Display only; staff cannot edit it and it never drives authorization or routing in the UI.

import type { BookingContactView, CustomerWhatsAppState } from "./legal-consent-contract";

export const whatsappStateLabels: Record<CustomerWhatsAppState, string> = {
  NONE: "WhatsApp: izin yok",
  OPTED_IN: "WhatsApp: izin var",
  OPTED_OUT: "WhatsApp: müşteri durdurdu",
};

/** Profile values the surrounding view already shows. `undefined` = not shown/unknown. */
export type DisplayedProfile = Readonly<{
  displayName?: string;
  phone?: string | null;
  email?: string | null;
}>;

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

/** Snapshot fields worth showing: those with a value that differs from (or is absent in) the displayed profile. */
export function differingContactFields(contact: BookingContactView, profile: DisplayedProfile) {
  const fields: Array<{ key: "displayName" | "phone" | "email"; label: string; value: string }> = [];
  if (contact.displayName && norm(contact.displayName) !== norm(profile.displayName)) {
    fields.push({ key: "displayName", label: "Ad", value: contact.displayName });
  }
  if (contact.phone && norm(contact.phone) !== norm(profile.phone)) {
    fields.push({ key: "phone", label: "Telefon", value: contact.phone });
  }
  if (contact.email && norm(contact.email) !== norm(profile.email)) {
    fields.push({ key: "email", label: "E-posta", value: contact.email });
  }
  return fields;
}

export function BookingContactSummary({
  contact,
  profile,
}: {
  contact: BookingContactView | null | undefined;
  profile: DisplayedProfile;
}) {
  if (!contact) return null;
  const fields = differingContactFields(contact, profile);

  return (
    <div className="mt-2 space-y-1 text-sm">
      {fields.length > 0 && (
        <div className="rounded-lg border border-separator bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-ink-muted">Randevuda girilen iletişim</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-ink">
            {fields.map((field) => (
              <div key={field.key} className="contents">
                <dt className="text-ink-muted">{field.label}:</dt>
                <dd className="break-all">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="text-xs text-ink-muted">{whatsappStateLabels[contact.whatsapp]}</p>
    </div>
  );
}
