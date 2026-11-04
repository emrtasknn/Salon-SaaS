import type { TenantId } from "./tenant-context";

export const TENANT_SLUG_MAX_LENGTH = 80;
export const TENANT_NAME_MAX_LENGTH = 160;

/** WP-07: tenant lifecycle flag. INACTIVE blocks every new-booking path; it is server-only state. */
export type TenantStatus = "ACTIVE" | "INACTIVE";
export const TENANT_STATUSES: ReadonlyArray<TenantStatus> = Object.freeze(["ACTIVE", "INACTIVE"]);

export function isTenantStatus(value: unknown): value is TenantStatus {
  return value === "ACTIVE" || value === "INACTIVE";
}

/** Must stay identical to the DB CHECK "Tenant_contactPhone_e164_check". */
export const TENANT_CONTACT_PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/;

export type TenantValidationErrorCode =
  | "INVALID_TENANT_NAME"
  | "INVALID_TENANT_SLUG"
  | "INVALID_TIMEZONE"
  | "INVALID_CONTACT_PHONE";

export type TenantValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TenantValidationErrorCode; readonly message: string } };

function failure(
  code: TenantValidationErrorCode,
  message: string,
): TenantValidationResult<never> {
  return { ok: false, error: { code, message } };
}

export function createTenantName(raw: unknown): TenantValidationResult<string> {
  if (typeof raw !== "string") {
    return failure("INVALID_TENANT_NAME", "Tenant name must be a string.");
  }

  const value = raw.trim();
  if (value.length === 0) {
    return failure("INVALID_TENANT_NAME", "Tenant name must not be empty.");
  }
  if (value.length > TENANT_NAME_MAX_LENGTH) {
    return failure(
      "INVALID_TENANT_NAME",
      `Tenant name must be at most ${TENANT_NAME_MAX_LENGTH} characters.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return failure(
      "INVALID_TENANT_NAME",
      "Tenant name must not contain control characters.",
    );
  }

  return { ok: true, value };
}

const TURKISH_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
});

function transliterateTurkish(value: string): string {
  return [...value]
    .map((character) => TURKISH_CHARACTERS[character] ?? character)
    .join("");
}

export function normalizeTenantSlug(raw: unknown): TenantValidationResult<string> {
  if (typeof raw !== "string") {
    return failure("INVALID_TENANT_SLUG", "Tenant slug must be a string.");
  }

  let value = raw.trim().toLocaleLowerCase("tr-TR");
  value = transliterateTurkish(value);
  value = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  value = value.replace(/[\s_]+/g, "-");
  value = value.replace(/[^a-z0-9-]/g, "-");
  value = value.replace(/-+/g, "-").replace(/^-|-$/g, "");

  if (value.length === 0) {
    return failure(
      "INVALID_TENANT_SLUG",
      "Tenant slug must contain at least one supported character.",
    );
  }
  if (value.length > TENANT_SLUG_MAX_LENGTH) {
    return failure(
      "INVALID_TENANT_SLUG",
      `Tenant slug must be at most ${TENANT_SLUG_MAX_LENGTH} characters after normalization.`,
    );
  }

  return { ok: true, value };
}

export function createTenantTimezone(
  raw: unknown,
): TenantValidationResult<string> {
  if (typeof raw !== "string") {
    return failure("INVALID_TIMEZONE", "Timezone must be a string.");
  }

  const value = raw.trim();
  if (value.length === 0 || value !== raw) {
    return failure("INVALID_TIMEZONE", "Timezone must be a trimmed IANA identifier.");
  }

  try {
    const resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;

    return { ok: true, value: resolved };
  } catch {
    return failure("INVALID_TIMEZONE", "Timezone must be a valid IANA timezone.");
  }
}

export type TenantProvisioningData = Readonly<{
  tenantId: TenantId;
  name: string;
  slug: string;
  timezone: string;
}>;

/**
 * WP-07: normalizes a salon contact phone to E.164.
 * Strips spaces, "-", "(", ")" and "."; "00" prefix -> "+"; Turkish mobile
 * "05xxxxxxxxx" / "5xxxxxxxxx" -> "+905xxxxxxxxx". Empty input clears the phone (null).
 */
export function createTenantContactPhone(
  raw: unknown,
): TenantValidationResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return failure("INVALID_CONTACT_PHONE", "Contact phone must be a string.");
  }

  let value = raw.replace(/[\s\-().]/g, "");
  if (value.length === 0) return { ok: true, value: null };

  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  else if (/^05[0-9]{9}$/.test(value)) value = `+90${value.slice(1)}`;
  else if (/^5[0-9]{9}$/.test(value)) value = `+90${value}`;

  if (!TENANT_CONTACT_PHONE_PATTERN.test(value)) {
    return failure(
      "INVALID_CONTACT_PHONE",
      "Contact phone must be a valid international (E.164) number.",
    );
  }

  return { ok: true, value };
}

/** WP-07: public wa.me click-to-chat URL; null when there is no valid E.164 phone. */
export function whatsAppLink(phone: string | null): string | null {
  if (typeof phone !== "string" || !TENANT_CONTACT_PHONE_PATTERN.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}`;
}
