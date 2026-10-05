import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTenantContext,
  createTenantId,
  TENANT_ID_MAX_LENGTH,
  type TenantContext,
  type TenantId,
} from "./tenant-context";

describe("createTenantId", () => {
  it("accepts valid opaque identifiers without normalization", () => {
    for (const raw of [
      "550e8400-e29b-41d4-a716-446655440000",
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "12345",
      "salon-a",
    ]) {
      expect(createTenantId(raw)).toEqual({ ok: true, value: raw });
    }
  });

  it.each([123, null, undefined, {}, []])(
    "rejects non-string input: %p",
    (raw) => {
      const result = createTenantId(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_TENANT_ID");
    },
  );

  it.each(["", "   ", " padded ", "tenant\u0000id"])(
    "rejects invalid string: %p",
    (raw) => {
      const result = createTenantId(raw);
      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "INVALID_TENANT_ID" }),
        }),
      );
    },
  );

  it("rejects identifiers longer than the maximum", () => {
    const result = createTenantId("a".repeat(TENANT_ID_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TENANT_ID");
  });
});

describe("createTenantContext", () => {
  it("creates an immutable context from a valid tenant id", () => {
    const result = createTenantContext({ tenantId: "tenant-a" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tenantId).toBe("tenant-a");
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it.each([undefined, null, {}, { tenantId: 123 }])(
    "rejects invalid context input: %p",
    (input) => {
      const result = createTenantContext(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_TENANT_CONTEXT");
    },
  );

  it("rejects mutation of a frozen context", () => {
    const result = createTenantContext({ tenantId: "tenant-a" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => {
        (result.value as { tenantId: TenantId }).tenantId =
          createTenantId("tenant-b").ok
            ? createTenantId("tenant-b").value
            : result.value.tenantId;
      }).toThrow(TypeError);
      expect(result.value.tenantId).toBe("tenant-a");
    }
  });
});

describe("tenant context module boundaries", () => {
  it("has no infrastructure imports", () => {
    const source = readFileSync(
      join(process.cwd(), "src/domain/tenant-context.ts"),
      "utf8",
    );

    expect(source).not.toMatch(
      /^\s*import\s+.*from\s+["'](?:.*(?:supabase|prisma|next|react)|@\/)/m,
    );
  });
});

// Type-level invariant: a plain string must not satisfy the branded boundary.
// @ts-expect-error Plain strings are not TenantId values.
const plainStringIsNotTenantId: TenantId = "tenant-a";

// @ts-expect-error TenantContext must be constructed through the validated boundary.
const unvalidatedContextIsNotAllowed: TenantContext = { tenantId: "tenant-a" };

void plainStringIsNotTenantId;
void unvalidatedContextIsNotAllowed;
