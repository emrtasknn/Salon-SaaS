/**
 * Framework-agnostic tenant identity and application context contract.
 *
 * Tenant IDs are opaque validated strings. Their persistence format is intentionally
 * deferred to the future persistence layer. Constructing a TenantContext does not
 * authenticate or authorize the caller; a future trusted server-side resolver must
 * establish the context from an authenticated membership before authorization.
 */

declare const TenantIdBrand: unique symbol;

export type TenantId = string & {
  readonly [TenantIdBrand]: true;
};

export type TenantContext = Readonly<{
  tenantId: TenantId;
}>;

export type DomainErrorCode =
  | "INVALID_TENANT_ID"
  | "INVALID_TENANT_CONTEXT";

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: DomainErrorCode;
        readonly message: string;
      };
    };

export const TENANT_ID_MAX_LENGTH = 128;

function invalidTenantId(message: string): DomainResult<TenantId> {
  return {
    ok: false,
    error: { code: "INVALID_TENANT_ID", message },
  };
}

export function createTenantId(raw: unknown): DomainResult<TenantId> {
  if (typeof raw !== "string") {
    return invalidTenantId("Tenant ID must be a string.");
  }
  if (raw.length === 0 || raw.trim().length === 0) {
    return invalidTenantId("Tenant ID must not be empty or whitespace-only.");
  }
  if (raw !== raw.trim()) {
    return invalidTenantId("Tenant ID must not contain surrounding whitespace.");
  }
  if (raw.length > TENANT_ID_MAX_LENGTH) {
    return invalidTenantId(
      `Tenant ID must be at most ${TENANT_ID_MAX_LENGTH} characters.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return invalidTenantId("Tenant ID must not contain control characters.");
  }

  return { ok: true, value: raw as TenantId };
}

export function createTenantContext(
  input: unknown,
): DomainResult<TenantContext> {
  if (typeof input !== "object" || input === null || !("tenantId" in input)) {
    return {
      ok: false,
      error: {
        code: "INVALID_TENANT_CONTEXT",
        message: "Tenant context must contain a tenantId.",
      },
    };
  }

  const tenantIdResult = createTenantId(input.tenantId);
  if (!tenantIdResult.ok) {
    return {
      ok: false,
      error: {
        code: "INVALID_TENANT_CONTEXT",
        message: tenantIdResult.error.message,
      },
    };
  }

  return {
    ok: true,
    value: Object.freeze({ tenantId: tenantIdResult.value }),
  };
}
