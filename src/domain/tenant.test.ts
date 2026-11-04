import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TENANT_CONTACT_PHONE_PATTERN,
  createTenantContactPhone,
  isTenantStatus,
  whatsAppLink,
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

describe("tenant contact phone (WP-07)", () => {
  it("pins the E.164 pattern to the DB CHECK constraint", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261104120000_tenant_status_contact_phone/migration.sql"),
      "utf8",
    );
    const match = sql.match(/CHECK \("contactPhone" ~ '([^']+)'\)/);
    expect(match?.[1]).toBe(TENANT_CONTACT_PHONE_PATTERN.source);
  });

  it.each([
    ["+905551112233", "+905551112233"],
    ["+90 (555) 111-22.33", "+905551112233"],
    ["05551112233", "+905551112233"],
    ["0555 111 22 33", "+905551112233"],
    ["5551112233", "+905551112233"],
    ["00905551112233", "+905551112233"],
    ["0044 20 7946 0958", "+442079460958"],
  ])("normalizes %s to E.164", (raw, expected) => {
    expect(createTenantContactPhone(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "   ", " - ( ) . "])("treats blank input %j as clearing the phone", (raw) => {
    expect(createTenantContactPhone(raw)).toEqual({ ok: true, value: null });
  });

  it.each([
    "abc",
    "+0905551112233",
    "+12345",
    "+1234567890123456",
    "905551112233",
    "0212 111 22 33x",
    "+90555\u00001112233",
    "0000",
  ])("rejects %j with INVALID_CONTACT_PHONE", (raw) => {
    const result = createTenantContactPhone(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CONTACT_PHONE");
  });

  it("rejects non-string input", () => {
    const result = createTenantContactPhone(5551112233);
    expect(result.ok).toBe(false);
  });

  it("builds wa.me links only for valid E.164 phones", () => {
    expect(whatsAppLink("+905551112233")).toBe("https://wa.me/905551112233");
    expect(whatsAppLink(null)).toBeNull();
    expect(whatsAppLink("05551112233")).toBeNull();
    expect(whatsAppLink("+90555<script>")).toBeNull();
  });

  it("recognizes only ACTIVE and INACTIVE as tenant statuses", () => {
    expect(isTenantStatus("ACTIVE")).toBe(true);
    expect(isTenantStatus("INACTIVE")).toBe(true);
    expect(isTenantStatus("active")).toBe(false);
    expect(isTenantStatus(undefined)).toBe(false);
  });
});
