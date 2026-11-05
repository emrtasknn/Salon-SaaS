// WP-10 test support (not a test file): KVKK legal fields for tenant fixtures and the
// notice / opt-in hashes a public booking form would send back. Hashes are always computed
// with the real renderers in src/domain/legal-notice.ts, never hard-coded.
import {
  CUSTOMER_NOTICE,
  WHATSAPP_OPTIN,
  customerNoticeHash,
  whatsAppOptInHash,
} from "../domain/legal-notice";

/** Valid values for Tenant.legalName / legalAddress / kvkkContactEmail (pass the DB CHECKs). */
export const TEST_TENANT_LEGAL = Object.freeze({
  legalName: "Test Güzellik Hizmetleri Ltd. Şti.",
  legalAddress: "Test Cad. No:1, Kadıköy / İstanbul",
  kvkkContactEmail: "kvkk@example.test",
});

/** Column list + value placeholders to splice into a raw `INSERT INTO "Tenant"`. */
export const TENANT_LEGAL_COLUMNS_SQL = `"legalName", "legalAddress", "kvkkContactEmail"`;
export const TENANT_LEGAL_VALUES = [
  TEST_TENANT_LEGAL.legalName,
  TEST_TENANT_LEGAL.legalAddress,
  TEST_TENANT_LEGAL.kvkkContactEmail,
] as const;

/** Tenant fields the notice renders from; `name` / `contactPhone` must match the seeded row. */
export function legalTenant(name: string, contactPhone: string | null = null) {
  return { name, contactPhone, ...TEST_TENANT_LEGAL };
}

/** Repository-level fields (PublicBookingRepository.create). */
export function shownLegalHashes(name: string, options: Readonly<{ contactPhone?: string | null; optIn?: boolean }> = {}) {
  const tenant = legalTenant(name, options.contactPhone ?? null);
  return options.optIn
    ? { shownNoticeHash: customerNoticeHash(tenant), whatsappOptIn: true, shownOptInHash: whatsAppOptInHash(tenant) }
    : { shownNoticeHash: customerNoticeHash(tenant), whatsappOptIn: false, shownOptInHash: null };
}

/**
 * Raw INSERT of a PUBLIC_FORM "AppointmentContact" row (for suites that seed appointments with SQL).
 * `optIn` records the current opt-in text; `optedOut` also sets optOutAt (opt-in kept, per the CHECKs).
 */
export function publicContactInsert(row: Readonly<{
  tenantId: string; appointmentId: string; tenantName: string; displayName: string;
  phone: string | null; optIn: boolean; optedOut?: boolean; contactPhone?: string | null;
}>): [string, unknown[]] {
  const tenant = legalTenant(row.tenantName, row.contactPhone ?? null);
  const optIn = row.optIn;
  const sql = `INSERT INTO "AppointmentContact"
      ("id", "tenantId", "appointmentId", "source", "displayName", "phone",
       "noticeVersion", "noticeHash", "noticeShownAt",
       "whatsappOptIn", "optInVersion", "optInHash", "optInAt", "optOutAt", "createdAt")
    VALUES ($1, $2, $3, 'PUBLIC_FORM', $4, $5, $6, $7, (now() AT TIME ZONE 'UTC'),
       $8, $9, $10,
       CASE WHEN $8 THEN (now() AT TIME ZONE 'UTC') ELSE NULL END,
       CASE WHEN $11 THEN (now() AT TIME ZONE 'UTC') + interval '1 second' ELSE NULL END,
       now())`;
  return [sql, [
    `contact-${row.appointmentId}`, row.tenantId, row.appointmentId, row.displayName, row.phone,
    CUSTOMER_NOTICE.version, customerNoticeHash(tenant),
    optIn, optIn ? WHATSAPP_OPTIN.version : null, optIn ? whatsAppOptInHash(tenant) : null,
    optIn && row.optedOut === true,
  ]];
}

/** Application-level fields (createPublicBooking(...).create), as PublicLegalView would send them. */
export function publicLegalInput(name: string, options: Readonly<{ contactPhone?: string | null; optIn?: boolean }> = {}) {
  const tenant = legalTenant(name, options.contactPhone ?? null);
  return {
    noticeVersion: CUSTOMER_NOTICE.version,
    noticeHash: customerNoticeHash(tenant),
    whatsappOptIn: options.optIn === true,
    optInVersion: options.optIn ? WHATSAPP_OPTIN.version : null,
    optInHash: options.optIn ? whatsAppOptInHash(tenant) : null,
  };
}
