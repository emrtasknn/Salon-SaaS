import type { TenantContext } from "../domain/tenant-context";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import { CUSTOMER_NOTICE, WHATSAPP_OPTIN } from "../domain/legal-notice";
import { normalizeE164Phone } from "../domain/tenant";
import { normalizeExtraServiceIds } from "../domain/multi-service";

export type PublicBookingRepository = Readonly<{
  /**
   * WP-10: in the booking transaction, re-reads the tenant (after the FOR SHARE status read),
   * returns "tenant_legal_incomplete" when the legal fields are missing, and inserts the
   * AppointmentContact snapshot with the hash of the CURRENT rendered notice (and opt-in text).
   * Never updates an existing Profile from public input.
   */
  create(
    tenantContext: TenantContext,
    input: Readonly<{
      serviceId: string; staffId: string; startAt: Date;
      /** Further services after serviceId, same staff, back to back (owner decision 2026-11-06). */
      extraServiceIds?: ReadonlyArray<string>;
      displayName: string; email: string; phone: string | null;
      /** SHA-256 hex of the status-link token; the raw token never reaches persistence. */
      accessTokenHash: string;
      /** True only together with a non-null E.164 phone. Absent = no opt-in. */
      whatsappOptIn?: boolean;
      /**
       * Hashes of the texts the form displayed. Compared with the texts rendered from the FOR SHARE
       * tenant row; a mismatch (or an absent value) is "notice_stale". Typed optional only so older
       * callers still compile; the application layer always passes them.
       */
      shownNoticeHash?: string;
      /** Required when whatsappOptIn is true. */
      shownOptInHash?: string | null;
    }>,
  ): Promise<{ status: "created"; appointmentId: string } | "slot_unavailable" | "invalid_resource" | "tenant_inactive" | "tenant_legal_incomplete" | "notice_stale" | "persistence_failure">;
}>;

/** Caps equal the AppointmentContact VARCHAR columns. */
const DISPLAY_NAME_MAX = 160;
const EMAIL_MAX = 254;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

function normalizeText(value: unknown, required: boolean): string | null | "INVALID" {
  if (typeof value !== "string") return required ? "INVALID" : null;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return required ? "INVALID" : null;
  return normalized;
}

export function createPublicBooking(repository: PublicBookingRepository) {
  return {
    async create(tenantContext: TenantContext, input: Readonly<{
      serviceId: string; staffId: string; startAt: unknown; displayName: unknown; email: unknown; phone?: unknown;
      extraServiceIds?: unknown;
      /** Versions the form displayed; must equal the current server templates. */
      noticeVersion?: unknown; whatsappOptIn?: unknown; optInVersion?: unknown;
      /** Hashes of the displayed texts (PublicLegalView); compared in the booking tx. */
      noticeHash?: unknown; optInHash?: unknown;
    }>) {
      const displayName = normalizeText(input.displayName, true);
      const email = normalizeText(input.email, true);
      if (displayName === "INVALID" || email === "INVALID" || displayName === null || email === null ||
        displayName.length > DISPLAY_NAME_MAX || email.length > EMAIL_MAX || !EMAIL.test(email) ||
        !(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime()) ||
        (input.whatsappOptIn !== undefined && typeof input.whatsappOptIn !== "boolean")) return { status: "INVALID_INPUT" as const };
      const extraServiceIds = normalizeExtraServiceIds(input.serviceId, input.extraServiceIds);
      if (extraServiceIds === "INVALID") return { status: "INVALID_INPUT" as const };
      const whatsappOptIn = input.whatsappOptIn === true;
      const noticeHash = input.noticeHash;
      const optInHash = whatsappOptIn ? input.optInHash : null;
      if (typeof noticeHash !== "string" || !SHA256_HEX.test(noticeHash) ||
        (whatsappOptIn && (typeof optInHash !== "string" || !SHA256_HEX.test(optInHash)))) return { status: "INVALID_INPUT" as const };
      // WP-10: the shown notice (and opt-in text) must be the current version; else the page reloads.
      if (input.noticeVersion !== CUSTOMER_NOTICE.version) return { status: "NOTICE_STALE" as const };
      if (whatsappOptIn && input.optInVersion !== WHATSAPP_OPTIN.version) return { status: "NOTICE_STALE" as const };
      const phone = normalizeE164Phone(input.phone); // empty / missing -> null
      if (!phone.ok) return { status: "INVALID_PHONE" as const };
      if (whatsappOptIn && phone.value === null) return { status: "OPT_IN_REQUIRES_PHONE" as const };
      const { token, tokenHash } = generateAppointmentAccessToken();
      const result = await repository.create(tenantContext, {
        serviceId: input.serviceId, staffId: input.staffId, startAt: input.startAt,
        ...(extraServiceIds.length ? { extraServiceIds } : {}),
        displayName, email, phone: phone.value, accessTokenHash: tokenHash, whatsappOptIn,
        shownNoticeHash: noticeHash, shownOptInHash: typeof optInHash === "string" ? optInHash : null,
      });
      if (typeof result === "object" && result.status === "created") {
        return { status: "created" as const, appointmentId: result.appointmentId, accessToken: token };
      }
      if (result === "slot_unavailable") return { status: "SLOT_UNAVAILABLE" as const };
      if (result === "invalid_resource") return { status: "INVALID_RESOURCE" as const };
      if (result === "tenant_inactive") return { status: "TENANT_INACTIVE" as const };
      if (result === "tenant_legal_incomplete") return { status: "TENANT_LEGAL_INCOMPLETE" as const };
      if (result === "notice_stale") return { status: "NOTICE_STALE" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },
  };
}
