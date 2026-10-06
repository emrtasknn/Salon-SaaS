import { describe, expect, it } from "vitest";
import {
  createTenantName,
  createTenantTimezone,
  normalizeTenantSlug,
} from "./tenant";

describe("tenant domain", () => {
  it("normalizes Turkish salon names into URL-safe slugs", () => {
    expect(normalizeTenantSlug(" Güzellik & Bakım Şubesi ")).toEqual({
      ok: true,
      value: "guzellik-bakim-subesi",
    });
  });

  it("collapses separators and removes unsupported characters", () => {
    expect(normalizeTenantSlug("  Saç__&__Makyaj  ")).toEqual({
      ok: true,
      value: "sac-makyaj",
    });
  });

  it("rejects an empty normalized slug", () => {
    expect(normalizeTenantSlug("§©™")).toEqual({
      ok: false,
      error: {
        code: "INVALID_TENANT_SLUG",
        message: "Tenant slug must contain at least one supported character.",
      },
    });
  });

  it("trims and validates the salon name", () => {
    expect(createTenantName("  Salon Ada  ")).toEqual({
      ok: true,
      value: "Salon Ada",
    });
  });

  it("normalizes and validates IANA timezones", () => {
    expect(createTenantTimezone("Europe/Istanbul")).toEqual({
      ok: true,
      value: "Europe/Istanbul",
    });
    expect(createTenantTimezone("Not/A_Timezone").ok).toBe(false);
  });
});