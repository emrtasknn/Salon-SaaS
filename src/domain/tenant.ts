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
  | "INVALID_CONTACT_PHONE"
  | "INVALID_LEGAL_NAME"
  | "INVALID_LEGAL_ADDRESS"
  | "INVALID_KVKK_EMAIL"
  | "INVALID_PUBLIC_ADDRESS"
  | "INVALID_MAPS_URL";

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

/**
 * MVP supports only Europe/Istanbul (no DST). Owner decision 2026-11-04 (WP-11):
 * availability checks the closing time in wall-clock minutes but computes `endAt`
 * in elapsed time, so on a spring-forward day a DST zone could book past closing.
 * Widen this list only together with that fix.
 */
export const MVP_SUPPORTED_TIMEZONES: ReadonlyArray<string> = ["Europe/Istanbul"];

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

    if (!MVP_SUPPORTED_TIMEZONES.includes(resolved)) {
      return failure("INVALID_TIMEZONE", "Only Europe/Istanbul is supported in the MVP.");
    }

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

/**
 * WP-10: generic E.164 normalization (same rules as the salon contact phone), used for the
 * customer phone of a booking contact snapshot. Not the rate-limit subject normalizer.
 */
export const normalizeE164Phone = createTenantContactPhone;

/** WP-10: KVKK controller identity on Tenant. Caps equal the VARCHAR(n) columns. */
export const TENANT_LEGAL_NAME_MAX_LENGTH = 200;
export const TENANT_LEGAL_ADDRESS_MAX_LENGTH = 500;
export const TENANT_KVKK_EMAIL_MAX_LENGTH = 254;

// C0/C1 control characters. JS trim() removes a superset of the DB's [[:space:]] at both ends,
// so a trimmed, non-empty value without control characters satisfies the "trimmed non-blank" CHECKs.
const LEGAL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/** Stricter than the DB CHECK "Tenant_kvkkContactEmail_format_check" (also requires a dot in the domain). */
const KVKK_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function legalText(
  raw: unknown,
  code: TenantValidationErrorCode,
  maxLength: number,
  label: string,
): TenantValidationResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return failure(code, `${label} must be a string.`);
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > maxLength) return failure(code, `${label} must be at most ${maxLength} characters.`);
  if (LEGAL_CONTROL_CHARACTERS.test(value)) return failure(code, `${label} must not contain control characters.`);
  return { ok: true, value };
}

/** WP-10: salon legal (trade) name. Empty input clears it (null). */
export function createTenantLegalName(raw: unknown): TenantValidationResult<string | null> {
  return legalText(raw, "INVALID_LEGAL_NAME", TENANT_LEGAL_NAME_MAX_LENGTH, "Legal name");
}

/** WP-10: salon notice address. Line breaks (textarea input) become ", ". Empty input clears it (null). */
export function createTenantLegalAddress(raw: unknown): TenantValidationResult<string | null> {
  const flattened = typeof raw === "string" ? raw.trim().replace(/[ \t]*\r?\n\s*/g, ", ") : raw;
  return legalText(flattened, "INVALID_LEGAL_ADDRESS", TENANT_LEGAL_ADDRESS_MAX_LENGTH, "Legal address");
}

/** WP-10: KVKK application e-mail of the salon. Empty input clears it (null). */
export function createTenantKvkkContactEmail(raw: unknown): TenantValidationResult<string | null> {
  const result = legalText(raw, "INVALID_KVKK_EMAIL", TENANT_KVKK_EMAIL_MAX_LENGTH, "KVKK contact e-mail");
  if (!result.ok || result.value === null) return result;
  if (!KVKK_EMAIL_PATTERN.test(result.value)) {
    return failure("INVALID_KVKK_EMAIL", "KVKK contact e-mail must be a valid e-mail address.");
  }
  return result;
}

/** Salon location shown to customers (separate from the KVKK legalAddress). Caps equal the VARCHAR(n) columns. */
export const TENANT_PUBLIC_ADDRESS_MAX_LENGTH = 300;
export const TENANT_MAPS_URL_MAX_LENGTH = 500;

/**
 * Must stay identical to the DB CHECK "Tenant_mapsUrl_allowlist_check": https only, no userinfo/port,
 * host from a fixed maps allowlist; generic Google hosts only under the /maps path.
 */
export const TENANT_MAPS_URL_PATTERN =
  /^https:\/\/(maps\.app\.goo\.gl|maps\.google\.com|maps\.apple\.com|goo\.gl\/maps|(www\.)?google\.com\/maps|www\.google\.com\.tr\/maps)([/?#][^\s]*)?$/;

const MAPS_URL_PATTERN_CASE_INSENSITIVE = new RegExp(TENANT_MAPS_URL_PATTERN.source, "i");

/** Hosts accepted for any path. */
const MAPS_HOSTS_ANY_PATH: ReadonlySet<string> = new Set(["maps.app.goo.gl", "maps.google.com", "maps.apple.com"]);
/** Hosts accepted only when the path is /maps or below. */
const MAPS_HOSTS_MAPS_PATH: ReadonlySet<string> = new Set(["goo.gl", "google.com", "www.google.com", "www.google.com.tr"]);

/** Public salon address. Line breaks (textarea input) become ", ". Empty input clears it (null). */
export function createTenantPublicAddress(raw: unknown): TenantValidationResult<string | null> {
  const flattened = typeof raw === "string" ? raw.trim().replace(/[ \t]*\r?\n\s*/g, ", ") : raw;
  return legalText(flattened, "INVALID_PUBLIC_ADDRESS", TENANT_PUBLIC_ADDRESS_MAX_LENGTH, "Public address");
}

/** True only for a normalized maps link on the allowlist (also checked before rendering a stored value). */
export function isAllowedMapsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > TENANT_MAPS_URL_MAX_LENGTH) return false;
  if (!TENANT_MAPS_URL_PATTERN.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  if (url.href !== value) return false;
  if (MAPS_HOSTS_ANY_PATH.has(url.hostname)) return true;
  if (MAPS_HOSTS_MAPS_PATH.has(url.hostname)) return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
  return false;
}

/**
 * Maps "share" link pasted by the salon admin. Returns the URL-normalized form; rejects any host
 * outside the maps allowlist (no open redirect / phishing links on the public page). Empty clears it.
 */
export function createTenantMapsUrl(raw: unknown): TenantValidationResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return failure("INVALID_MAPS_URL", "Maps link must be a string.");
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  // The URL parser silently drops tabs/newlines; reject them (and any whitespace/control char) up front.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    return failure("INVALID_MAPS_URL", "Maps link must not contain spaces or control characters.");
  }
  // Check the raw input too: the URL parser would silently drop a default port (":443") or fix up
  // a malformed authority, so the allowlist shape must hold before normalization as well.
  if (!MAPS_URL_PATTERN_CASE_INSENSITIVE.test(trimmed)) {
    return failure("INVALID_MAPS_URL", "Maps link must be an https Google Maps or Apple Maps link.");
  }
  let normalized: string;
  try {
    normalized = new URL(trimmed).href;
  } catch {
    return failure("INVALID_MAPS_URL", "Maps link must be a valid URL.");
  }
  if (!isAllowedMapsUrl(normalized)) {
    return failure("INVALID_MAPS_URL", "Maps link must be an https Google Maps or Apple Maps link.");
  }
  return { ok: true, value: normalized };
}

/**
 * Link customers follow to reach the salon: the stored maps link when it is still on the allowlist,
 * else a Google Maps search for the public address; null when neither is set.
 */
export function salonDirectionsUrl(
  location: Readonly<{ publicAddress: string | null; mapsUrl: string | null }>,
): string | null {
  if (isAllowedMapsUrl(location.mapsUrl)) return location.mapsUrl;
  const address = typeof location.publicAddress === "string" ? location.publicAddress.trim() : "";
  if (address.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
