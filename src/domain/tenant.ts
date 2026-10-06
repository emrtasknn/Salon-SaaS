import type { TenantId } from "./tenant-context";

export const TENANT_SLUG_MAX_LENGTH = 80;
export const TENANT_NAME_MAX_LENGTH = 160;

export type TenantValidationErrorCode =
  | "INVALID_TENANT_NAME"
  | "INVALID_TENANT_SLUG"
  | "INVALID_TIMEZONE";

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