export const REQUIRED_ENV_VARS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TEMPLATES_JSON",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_API_VERSION",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
] as const;

export const REQUIRED_TEMPLATE_KEYS = [
  "appointment-created-staff",
  "appointment-created-customer",
  "appointment-confirmed-customer",
  "appointment-rejected-customer",
] as const;

export type EnvCheck = Readonly<{ name: string; set: boolean }>;

export type TemplatesCheck = Readonly<{
  parsed: boolean;
  missingKeys: ReadonlyArray<string>;
}>;

export type PreflightResult = Readonly<{
  env: ReadonlyArray<EnvCheck>;
  templates: TemplatesCheck;
  ok: boolean;
}>;

export function runPreflight(
  env: Readonly<Record<string, string | undefined>> = process.env
): PreflightResult {
  const envChecks: Array<EnvCheck> = REQUIRED_ENV_VARS.map((name) => ({
    name,
    set: !!env[name],
  }));

  let templates: TemplatesCheck = { parsed: false, missingKeys: [] };
  const templatesJson = env.WHATSAPP_TEMPLATES_JSON;
  if (templatesJson) {
    try {
      const parsed = JSON.parse(templatesJson) as Record<string, unknown>;
      const missingKeys: Array<string> = [];
      for (const key of REQUIRED_TEMPLATE_KEYS) {
        if (!(key in parsed)) {
          missingKeys.push(key);
        }
      }
      templates = { parsed: true, missingKeys };
    } catch {
      templates = { parsed: false, missingKeys: [...REQUIRED_TEMPLATE_KEYS] };
    }
  }

  const ok =
    envChecks.every((c) => c.set) &&
    templates.parsed &&
    templates.missingKeys.length === 0;

  return { env: envChecks, templates, ok };
}

export function formatResult(result: PreflightResult): string {
  const lines: Array<string> = [];
  lines.push("WhatsApp preflight");
  lines.push("------------------");
  for (const check of result.env) {
    lines.push(`${check.name}: ${check.set ? "SET" : "MISSING"}`);
  }
  lines.push("");
  lines.push("Templates (WHATSAPP_TEMPLATES_JSON):");
  if (!result.templates.parsed) {
    lines.push("  parse: FAILED");
    for (const key of REQUIRED_TEMPLATE_KEYS) {
      lines.push(`  ${key}: MISSING (template JSON unparseable)`);
    }
  } else {
    lines.push("  parse: OK");
    for (const key of REQUIRED_TEMPLATE_KEYS) {
      lines.push(
        `  ${key}: ${
          result.templates.missingKeys.includes(key) ? "MISSING" : "PRESENT"
        }`
      );
    }
  }
  lines.push("");
  lines.push(
    result.ok
      ? "RESULT: PASS — WhatsApp configuration is ready for real send testing"
      : "RESULT: FAIL — WhatsApp configuration is incomplete or invalid"
  );
  return lines.join("\n");
}

if (process.argv[1] === import.meta.url) {
  const result = runPreflight();
  console.log(formatResult(result));
  process.exit(result.ok ? 0 : 1);
}
