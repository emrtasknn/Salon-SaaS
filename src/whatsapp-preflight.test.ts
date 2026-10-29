import { describe, expect, it } from "vitest";
import { formatResult, runPreflight } from "../scripts/whatsapp-preflight";

describe("WhatsApp preflight", () => {
  it("reports PASS when all env vars and templates are present", () => {
    const base: Readonly<Record<string, string | undefined>> = {
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_TEMPLATES_JSON: JSON.stringify({
        "appointment-created-staff": { name: "tpl_staff", languageCode: "tr" },
        "appointment-created-customer": { name: "tpl_customer_created", languageCode: "tr" },
        "appointment-confirmed-customer": { name: "tpl_confirmed", languageCode: "tr" },
        "appointment-rejected-customer": { name: "tpl_rejected", languageCode: "tr" },
      }),
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
      WHATSAPP_APP_SECRET: "appsecret",
    };
    const result = runPreflight(base);
    console.log(formatResult(result));
    expect(result.ok).toBe(true);
    for (const check of result.env) {
      expect(check.set).toBe(true);
    }
    expect(result.templates.parsed).toBe(true);
    expect(result.templates.missingKeys).toHaveLength(0);
  });

  it("reports FAIL and lists MISSING env vars without printing secret values", () => {
    const result = runPreflight({ WHATSAPP_ACCESS_TOKEN: "token" });
    const output = formatResult(result);
    console.log(output);
    expect(result.ok).toBe(false);
    expect(output).not.toContain("token");
    expect(output).not.toContain("appsecret");
    expect(output).not.toContain("verify");
    const missingNames = result.env
      .filter((c) => !c.set)
      .map((c) => c.name)
      .sort();
    expect(missingNames).toEqual([
      "WHATSAPP_API_VERSION",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_TEMPLATES_JSON",
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    ]);
  });

  it("reports missing template keys when WHATSAPP_TEMPLATES_JSON is empty", () => {
    const base: Readonly<Record<string, string | undefined>> = {
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_TEMPLATES_JSON: "{}",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
      WHATSAPP_APP_SECRET: "appsecret",
    };
    const result = runPreflight(base);
    console.log(formatResult(result));
    expect(result.ok).toBe(false);
    expect(result.templates.parsed).toBe(true);
    expect(result.templates.missingKeys).toEqual([
      "appointment-created-staff",
      "appointment-created-customer",
      "appointment-confirmed-customer",
      "appointment-rejected-customer",
    ]);
  });

  it("reports FAIL when WHATSAPP_TEMPLATES_JSON is unparseable", () => {
    const base: Readonly<Record<string, string | undefined>> = {
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_TEMPLATES_JSON: "{not valid json",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
      WHATSAPP_APP_SECRET: "appsecret",
    };
    const result = runPreflight(base);
    const output = formatResult(result);
    console.log(output);
    expect(result.ok).toBe(false);
    expect(result.templates.parsed).toBe(false);
    expect(output).toContain("parse: FAILED");
  });

  it("shows only SET/MISSING status, never secret values, in output", () => {
    const result = runPreflight({
      WHATSAPP_ACCESS_TOKEN: "super-secret-token",
      WHATSAPP_TEMPLATES_JSON: JSON.stringify({
        "appointment-created-staff": { name: "n", languageCode: "tr" },
        "appointment-created-customer": { name: "n", languageCode: "tr" },
        "appointment-confirmed-customer": { name: "n", languageCode: "tr" },
        "appointment-rejected-customer": { name: "n", languageCode: "tr" },
      }),
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "super-secret-verify",
      WHATSAPP_APP_SECRET: "super-secret-app-secret",
    });
    const output = formatResult(result);
    expect(output).not.toContain("super-secret-token");
    expect(output).not.toContain("super-secret-verify");
    expect(output).not.toContain("super-secret-app-secret");
    expect(output).toContain("WHATSAPP_ACCESS_TOKEN: SET");
    expect(output).toContain("RESULT: PASS");
  });
});
