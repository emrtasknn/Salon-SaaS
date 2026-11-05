import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_CONTACT_PHONE_PATTERN } from "./tenant";
import { toBookingContact, whatsAppStateOf } from "./appointment-contact";

const MIGRATION = "prisma/migrations/20261106100000_kvkk_notice_whatsapp_optin/migration.sql";

describe("AppointmentContact DB CHECK pins (WP-10)", () => {
  const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");

  it("pins AppointmentContact_phone_e164_check to TENANT_CONTACT_PHONE_PATTERN", () => {
    const match = sql.match(/"AppointmentContact_phone_e164_check"\s+CHECK \("phone" ~ '([^']+)'\)/);
    expect(match?.[1]).toBe(TENANT_CONTACT_PHONE_PATTERN.source);
  });

  it("keeps the Tenant contact phone CHECK and the AppointmentContact phone CHECK identical", () => {
    const tenantSql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261104120000_tenant_status_contact_phone/migration.sql"),
      "utf8",
    );
    const tenantPattern = tenantSql.match(/CHECK \("contactPhone" ~ '([^']+)'\)/)?.[1];
    const contactPattern = sql.match(/CHECK \("phone" ~ '([^']+)'\)/)?.[1];
    expect(contactPattern).toBeDefined();
    expect(contactPattern).toBe(tenantPattern);
  });
});

describe("whatsAppStateOf / toBookingContact (WP-10)", () => {
  const optOut = new Date("2026-11-06T10:00:00.000Z");

  it.each([
    ["no contact row", null, "NONE"],
    ["undefined", undefined, "NONE"],
    ["no opt-in", { whatsappOptIn: false, optOutAt: null }, "NONE"],
    ["active opt-in", { whatsappOptIn: true, optOutAt: null }, "OPTED_IN"],
    ["opted out", { whatsappOptIn: true, optOutAt: optOut }, "OPTED_OUT"],
  ] as const)("%s -> %s", (_label, contact, expected) => {
    expect(whatsAppStateOf(contact)).toBe(expected);
  });

  it("returns null without a contact row and exposes only snapshot fields + derived state", () => {
    expect(toBookingContact(null)).toBeNull();
    expect(toBookingContact(undefined)).toBeNull();
    const view = toBookingContact({
      displayName: "Ayşe", phone: "+905551112233", email: "ayse@example.test", whatsappOptIn: true, optOutAt: optOut,
      // Extra evidence columns must never leak into the staff view.
      ...({ noticeHash: "a".repeat(64), optInHash: "b".repeat(64) } as object),
    } as Parameters<typeof toBookingContact>[0]);
    expect(view).toEqual({ displayName: "Ayşe", phone: "+905551112233", email: "ayse@example.test", whatsapp: "OPTED_OUT" });
  });
});
