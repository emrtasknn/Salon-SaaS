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
  createTenantLegalName,
  createTenantLegalAddress,
  createTenantKvkkContactEmail,
  normalizeE164Phone,
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

  it("accepts only Europe/Istanbul in the MVP (DST zones are rejected)", () => {
    for (const zone of ["Europe/Berlin", "America/New_York", "UTC", "Europe/London"]) {
      const result = createTenantTimezone(zone);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_TIMEZONE");
    }
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

describe("tenant legal fields (WP-10)", () => {
  it("trims and accepts valid values; empty or missing clears to null", () => {
    expect(createTenantLegalName("  Ada Güzellik Ltd. Şti. ")).toEqual({ ok: true, value: "Ada Güzellik Ltd. Şti." });
    expect(createTenantLegalAddress(" Moda Cd. 1 ")).toEqual({ ok: true, value: "Moda Cd. 1" });
    expect(createTenantKvkkContactEmail(" kvkk@ada.example ")).toEqual({ ok: true, value: "kvkk@ada.example" });
    for (const empty of ["", " \t ", null, undefined]) {
      expect(createTenantLegalName(empty)).toEqual({ ok: true, value: null });
      expect(createTenantLegalAddress(empty)).toEqual({ ok: true, value: null });
      expect(createTenantKvkkContactEmail(empty)).toEqual({ ok: true, value: null });
    }
  });

  it("enforces the VARCHAR caps (200 / 500 / 254)", () => {
    expect(createTenantLegalName("a".repeat(200)).ok).toBe(true);
    expect(createTenantLegalName("a".repeat(201))).toMatchObject({ ok: false, error: { code: "INVALID_LEGAL_NAME" } });
    expect(createTenantLegalAddress("a".repeat(500)).ok).toBe(true);
    expect(createTenantLegalAddress("a".repeat(501))).toMatchObject({ ok: false, error: { code: "INVALID_LEGAL_ADDRESS" } });
    expect(createTenantKvkkContactEmail(`${"a".repeat(240)}@example.com`).ok).toBe(true);
    expect(createTenantKvkkContactEmail(`${"a".repeat(243)}@example.com`)).toMatchObject({ ok: false, error: { code: "INVALID_KVKK_EMAIL" } });
  });

  it("rejects control characters, non-strings and malformed e-mails", () => {
    expect(createTenantLegalName("Ada\u0000")).toMatchObject({ ok: false, error: { code: "INVALID_LEGAL_NAME" } });
    expect(createTenantLegalName("Ada\tLtd")).toMatchObject({ ok: false });
    expect(createTenantLegalName(42)).toMatchObject({ ok: false });
    for (const bad of ["kvkk", "kvkk@", "@ada.example", "kvkk@@ada.example", "kv kk@ada.example", "kvkk@ada"]) {
      expect(createTenantKvkkContactEmail(bad)).toMatchObject({ ok: false, error: { code: "INVALID_KVKK_EMAIL" } });
    }
  });

  it("flattens address line breaks to a comma", () => {
    expect(createTenantLegalAddress("Moda Cd. 1\r\n  Kadıköy\nİstanbul")).toEqual({ ok: true, value: "Moda Cd. 1, Kadıköy, İstanbul" });
  });

  it("accepted values satisfy the DB CHECK shapes", () => {
    const trimmedNonBlank = (v: string) => /\S/.test(v) && !/^\s|\s$/.test(v);
    for (const raw of [" a ", "Ada\n Ltd", "x"]) {
      const result = createTenantLegalAddress(raw);
      expect(result.ok && result.value !== null && trimmedNonBlank(result.value)).toBe(true);
    }
    const email = createTenantKvkkContactEmail("kvkk@ada.example");
    expect(email.ok && /^[^@\s]+@[^@\s]+$/.test(email.value ?? "")).toBe(true);
  });

  it("normalizeE164Phone reuses the contact phone rules", () => {
    expect(normalizeE164Phone("0555 111 22 33")).toEqual({ ok: true, value: "+905551112233" });
    expect(normalizeE164Phone("")).toEqual({ ok: true, value: null });
    expect(normalizeE164Phone("+90555").ok).toBe(false);
  });
});
