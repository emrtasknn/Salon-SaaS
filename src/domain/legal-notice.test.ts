import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NOTICE, LEGAL_PLACEHOLDER_PENDING, STAFF_VERBAL_OPTIN, WHATSAPP_OPTIN,
  customerNoticeHash, isLegalReady, renderFullNotice, renderNoticeRecordText, renderShortNotice,
  renderStaffVerbalOptIn, renderWhatsAppOptIn, sha256Hex, staffVerbalOptInHash, whatsAppOptInHash,
} from "./legal-notice";

const tenant = {
  name: "Salon Ada",
  legalName: "Ada Güzellik Ltd. Şti.",
  legalAddress: "Moda Cd. No:1, Kadıköy / İstanbul",
  kvkkContactEmail: "kvkk@salonada.example",
  contactPhone: "+905551112233",
};

describe("legal notice templates (WP-10)", () => {
  it("ships every template as a versioned draft", () => {
    for (const template of [CUSTOMER_NOTICE, WHATSAPP_OPTIN, STAFF_VERBAL_OPTIN]) {
      expect(template.draft).toBe(true);
      expect(template.version).toMatch(/^\S(.*\S)?$/);
      expect(template.version.length).toBeLessThanOrEqual(64);
    }
  });

  it("fills tenant fields into the short and full notice", () => {
    expect(renderShortNotice(tenant)).toContain("veri sorumlusu Salon Ada");
    const full = renderFullNotice(tenant);
    for (const value of [tenant.name, tenant.legalName, tenant.legalAddress, tenant.kvkkContactEmail, tenant.contactPhone, CUSTOMER_NOTICE.version]) {
      expect(full).toContain(value);
    }
    expect(full).not.toMatch(/\{\{|\}\}/);
  });

  it("keeps a visible marker for undecided values and missing tenant fields; omits a missing phone", () => {
    expect(renderFullNotice(tenant)).toContain(LEGAL_PLACEHOLDER_PENDING); // retention periods etc.
    const missing = renderFullNotice({ ...tenant, legalName: null, contactPhone: null });
    expect(missing).toContain(`veri sorumlusu sıfatıyla ${LEGAL_PLACEHOLDER_PENDING}`);
    expect(missing).not.toContain("Telefon:");
  });

  it("is pure and deterministic", () => {
    expect(renderFullNotice(tenant)).toBe(renderFullNotice({ ...tenant }));
    expect(customerNoticeHash(tenant)).toBe(customerNoticeHash({ ...tenant }));
  });

  it("hashes the exact rendered short + full text as lowercase sha256 hex", () => {
    const expected = createHash("sha256").update(`${renderShortNotice(tenant)}\n\n${renderFullNotice(tenant)}`, "utf8").digest("hex");
    expect(renderNoticeRecordText(tenant)).toBe(`${renderShortNotice(tenant)}\n\n${renderFullNotice(tenant)}`);
    expect(customerNoticeHash(tenant)).toBe(expected);
    expect(customerNoticeHash(tenant)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("changes the notice hash when any rendered tenant field changes", () => {
    const base = customerNoticeHash(tenant);
    expect(customerNoticeHash({ ...tenant, legalAddress: "Başka adres" })).not.toBe(base);
    expect(customerNoticeHash({ ...tenant, kvkkContactEmail: "other@salonada.example" })).not.toBe(base);
    expect(customerNoticeHash({ ...tenant, name: "Salon Ada 2" })).not.toBe(base);
  });

  it("names the business in the WhatsApp opt-in text (Meta) and hashes label + help", () => {
    const optIn = renderWhatsAppOptIn(tenant);
    expect(optIn.label).toContain("Salon Ada");
    expect(optIn.label).toContain("WhatsApp");
    expect(optIn.help).toContain("reklam veya kampanya mesajı gönderilmez");
    expect(whatsAppOptInHash(tenant)).toBe(sha256Hex(`${optIn.label}\n${optIn.help}`));
  });

  it("has a fixed staff verbal opt-in label and hash", () => {
    expect(renderStaffVerbalOptIn()).toContain("sözlü");
    expect(staffVerbalOptInHash()).toBe(sha256Hex(renderStaffVerbalOptIn()));
  });
});

describe("isLegalReady (WP-10)", () => {
  it("is true only when legal name, address and KVKK e-mail are all set and valid", () => {
    expect(isLegalReady(tenant)).toBe(true);
    expect(isLegalReady({ ...tenant, legalName: null })).toBe(false);
    expect(isLegalReady({ ...tenant, legalAddress: null })).toBe(false);
    expect(isLegalReady({ ...tenant, kvkkContactEmail: null })).toBe(false);
  });

  it("rejects blank, untrimmed or malformed values", () => {
    expect(isLegalReady({ ...tenant, legalName: " \t " })).toBe(false);
    expect(isLegalReady({ ...tenant, legalName: " Ada " })).toBe(false);
    expect(isLegalReady({ ...tenant, kvkkContactEmail: "not-an-email" })).toBe(false);
  });
});
