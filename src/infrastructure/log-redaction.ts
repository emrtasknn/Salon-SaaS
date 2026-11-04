// Log redaction (WP-12): masks phone numbers, emails and secrets before anything
// reaches server logs (Vercel / Supabase log retention is outside our control).
// Call sites should still avoid logging PII; this is the safety net.

export const REDACTED = "[REDACTED]";

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;

// Keys whose values are always secrets, compared after lowercasing and removing "_" / "-".
const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "apikey",
  "anonkey",
  "servicerolekey",
  "privatekey",
  "secretkey",
  "databaseurl",
  "directurl",
  "connectionstring",
  "otp",
]);
// Substring match so prefixed env-style names (SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY) are caught.
const SECRET_KEY_PARTS = [
  "password",
  "passwd",
  "token",
  "secret",
  "signature",
  "apikey",
  "anonkey",
  "servicerolekey",
  "privatekey",
  "databaseurl",
  "directurl",
  "connectionstring",
];

// Keys whose values are contact data and get partially masked.
const PHONE_KEY_PARTS = ["phone", "msisdn", "waid"];
const PHONE_KEYS = new Set(["to", "from", "recipient", "mobile", "gsm"]);
const EMAIL_KEY_PARTS = ["email", "mail"];

// Free-text content that may carry customer data.
const CONTENT_KEYS = new Set(["body", "text", "message_body", "templateparameters", "notes", "note"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Covers access_token, refresh_token, hub.verify_token, apikey, password, code, ...
const SECRET_PARAM = /\b([\w.]*(?:token|secret|password|apikey|api_key)|code)=[^&\s"']+/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/@\s]+):([^@\s]+)@/gi;
// 10-15 digits, optional leading +, with common separators; not glued to letters,
// digits or "-" (so UUID segments and ids are left alone). Allows "(555) " / " (555)" groups.
// Dates like "06.10.2026 14:00" or "2026-10-06 14:00" also match PHONE; keep them.
const DATE_LIKE = /^(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})(?:\D|$)/;
const PHONE = /(?<![\w-])(?:\+|\()?\d(?:(?:\s?\(|\)\s?|[\s.-])?\d){9,14}(?![\w-])/g;

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function keyKind(key: string): "secret" | "phone" | "email" | "content" | null {
  const normalized = normalizeKey(key);
  if (SECRET_KEYS.has(normalized) || SECRET_KEY_PARTS.some(part => normalized.includes(part))) return "secret";
  if (EMAIL_KEY_PARTS.some(part => normalized.includes(part))) return "email";
  // "phoneNumberId" is a Meta sender id, not a person's number, but masking it is harmless.
  if (PHONE_KEYS.has(normalized) || PHONE_KEY_PARTS.some(part => normalized.includes(part))) return "phone";
  if (CONTENT_KEYS.has(normalized) || CONTENT_KEYS.has(key.toLowerCase())) return "content";
  return null;
}

export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return REDACTED;
  return `${value[0]}***@${value.slice(at + 1)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return REDACTED;
  return `***${digits.slice(-2)}`;
}

export function redactString(input: string): string {
  if (UUID.test(input)) return input;
  const value = input.length > MAX_STRING_LENGTH ? `${input.slice(0, MAX_STRING_LENGTH)}…[truncated]` : input;
  return value
    .replace(URL_CREDENTIALS, (_match, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SECRET_PARAM, (_match, name: string) => `${name}=${REDACTED}`)
    .replace(EMAIL, match => maskEmail(match))
    .replace(PHONE, match => (DATE_LIKE.test(match) ? match : maskPhone(match)));
}

function redactByKind(kind: "secret" | "phone" | "email" | "content", value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (kind === "secret" || kind === "content") return REDACTED;
  if (typeof value !== "string" && typeof value !== "number") return REDACTED;
  const text = String(value);
  return kind === "email" ? maskEmail(text) : maskPhone(text);
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
    return value;
  }
  // `seen` holds only the current ancestors, so a shared (non-cyclic) object is
  // logged in full each time it appears.
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      // Stack traces can repeat the message; keep only name, message and a safe code.
      const code = (value as { code?: unknown }).code;
      return {
        name: value.name,
        message: redactString(value.message),
        ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      };
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[Invalid Date]" : value.toISOString();
    if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1, seen));

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const kind = keyKind(key);
      result[key] = kind ? redactByKind(kind, entry) : redactValue(entry, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** Returns a copy of `value` that is safe to write to server logs. */
export function redactForLog<T>(value: T): unknown {
  return redactValue(value, 0, new WeakSet());
}

/** console.error with redacted context. `event` is a fixed snake_case name. */
export function logError(event: string, context?: Readonly<Record<string, unknown>>): void {
  // Never throws: call sites log inside catch blocks before recording state.
  let safeEvent = "log_event";
  try {
    safeEvent = redactString(String(event));
    if (context === undefined) {
      console.error(safeEvent);
      return;
    }
    console.error(safeEvent, redactForLog(context));
  } catch {
    try {
      console.error(safeEvent, "[unloggable]");
    } catch {
      // Logging must not break the caller.
    }
  }
}
