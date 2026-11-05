// WP-10 UI <-> server contract (types only, no runtime code).
// Owner decisions: docs/tasks/WP-10.md (no notice checkbox; WhatsApp opt-in optional and
// unchecked; staff may record a verbal opt-in; customer WhatsApp only with an opt-in record).
// Legal wording lives in src/domain/legal-notice.ts (versioned DRAFT text) and is rendered
// on the server with tenant fields. The UI displays strings; it never builds legal text.
//
// Server functions (backend owns):
//   src/app/[slug]/legal-data.ts
//     loadPublicLegalView(slug: string): Promise<PublicLegalView | null>
//     loadFullNotice(slug: string): Promise<FullNoticeView | null>
//   src/app/[slug]/book/submit.ts
//     submitBooking(input: PublicBookingInput): Promise<PublicBookingResult>
//   src/app/[slug]/randevu/[token]/data.ts
//     loadCustomerAppointment(...)  -> ok result gains `whatsapp: CustomerWhatsAppState`
//   src/app/[slug]/randevu/[token]/actions.ts
//     stopWhatsAppByToken(slug: string, token: string): Promise<StopWhatsAppResult>
//   src/app/admin/calendar-actions.ts, src/app/staff/actions.ts (WP-08 create flows)
//     CreateOptionsView gains `verbalOptIn: VerbalOptInView`
//     create inputs gain `whatsappVerbalOptIn: boolean`
//     CreateAppointmentResult gains status "OPT_IN_REQUIRES_PHONE"
//   src/app/admin/settings-actions.ts
//     loadTenantSettings() settings gain `legal: TenantLegalFields`
//     updateTenantSettingsAction(formData) reads "legalName", "legalAddress", "kvkkContactEmail"
//     and may return error codes in TenantLegalErrorCode
//   staff/admin appointment list views gain `bookingContact: BookingContactView | null`

export type PublicLegalView = Readonly<{
  /** false → salon legal fields missing: hide the booking form, show a "not ready" message. */
  ready: boolean;
  noticeVersion: string;
  /** Short (layer 1) notice, plain text. Shown above the submit button, always visible. */
  shortNotice: string;
  /** Link target for the full notice, e.g. `/${slug}/aydinlatma`. */
  fullNoticePath: string;
  /** SHA-256 (lowercase hex) of the exact notice text shown (short + full); send back unchanged. */
  noticeHash: string;
  optInVersion: string;
  /** SHA-256 (lowercase hex) of the exact opt-in label + help shown; send back when opted in. */
  optInHash: string;
  /** Checkbox label for the optional WhatsApp opt-in. Unchecked by default. */
  optInLabel: string;
  /** Small help text under the opt-in checkbox. */
  optInHelp: string;
}>;

export type FullNoticeView = Readonly<{
  salonName: string;
  version: string;
  /** Full (layer 2) notice as plain text with "\n" line breaks; render with whitespace-pre-line. */
  text: string;
  /** True while the text is an unapproved draft; UI shows a visible "TASLAK" badge. */
  draft: boolean;
}>;

export type PublicBookingInput = Readonly<{
  slug: string;
  serviceId: string;
  staffId: string;
  startAtIso: string;
  displayName: string;
  email: string;
  phone: string;
  /** PublicLegalView.noticeVersion the form displayed. */
  noticeVersion: string;
  /** PublicLegalView.noticeHash the form displayed; mismatch with the text in force -> NOTICE_STALE. */
  noticeHash: string;
  whatsappOptIn: boolean;
  /** PublicLegalView.optInVersion when whatsappOptIn is true, else null. */
  optInVersion: string | null;
  /** PublicLegalView.optInHash when whatsappOptIn is true, else null. */
  optInHash: string | null;
}>;

export type PublicBookingResult =
  | Readonly<{ status: "created"; appointmentId: string; statusPath: string }>
  | Readonly<{ status: "RATE_LIMITED"; retryAfterSeconds: number }>
  | Readonly<{
      status:
        | "NOT_FOUND"
        | "TENANT_INACTIVE"
        /** Salon legal fields missing (re-checked in the booking transaction). */
        | "TENANT_LEGAL_INCOMPLETE"
        /** Displayed notice/opt-in version or text (hash) is not current: reload the page. */
        | "NOTICE_STALE"
        /** Opt-in ticked without a valid phone. */
        | "OPT_IN_REQUIRES_PHONE"
        /** Phone given but not normalizable to E.164. */
        | "INVALID_PHONE";
    }>
  /** Any pre-existing failure status of the booking flow, unchanged. */
  | Readonly<{ status: string }>;

export type CustomerWhatsAppState = "NONE" | "OPTED_IN" | "OPTED_OUT";

export type StopWhatsAppResult = Readonly<{
  status: "stopped" | "already_stopped" | "not_opted_in" | "not_found" | "rate_limited";
}>;

export type VerbalOptInView = Readonly<{
  version: string;
  /** Checkbox label, e.g. "Müşteri WhatsApp bilgilendirmesine sözlü olarak izin verdi". */
  label: string;
}>;

export type TenantLegalFields = Readonly<{
  legalName: string | null;
  legalAddress: string | null;
  kvkkContactEmail: string | null;
}>;

export type TenantLegalErrorCode = "INVALID_LEGAL_NAME" | "INVALID_LEGAL_ADDRESS" | "INVALID_KVKK_EMAIL";

/** Contact entered for this booking (snapshot). Read-only for staff; may differ from the profile. */
export type BookingContactView = Readonly<{
  displayName: string;
  phone: string | null;
  email: string | null;
  whatsapp: CustomerWhatsAppState;
}>;
