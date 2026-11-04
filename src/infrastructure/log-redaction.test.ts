import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED, logError, logInfo, maskEmail, maskPhone, redactForLog, redactString } from "./log-redaction";

const UUID_VALUE = "123e4567-e89b-12d3-a456-426614174000";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maskEmail / maskPhone", () => {
  it("keeps only the first character and the domain of an email", () => {
    expect(maskEmail("ayse.yilmaz@example.com")).toBe("a***@example.com");
    expect(maskEmail("no-at-sign")).toBe(REDACTED);
    expect(maskEmail("@example.com")).toBe(REDACTED);
  });

  it("keeps only the last two digits of a phone number", () => {
    expect(maskPhone("+90 555 123 45 67")).toBe("***67");
    expect(maskPhone("905551234567")).toBe("***67");
    expect(maskPhone("12")).toBe(REDACTED);
  });
});

describe("redactString", () => {
  it("masks the token in a customer status link path (WP-06)", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
    expect(redactString(`GET /salon-a/randevu/${token} failed`)).toBe("GET /salon-a/randevu/[REDACTED] failed");
    expect(redactString("https://x.test/salon-a/randevu/" + token + "?a=1")).not.toContain(token);
  });

  it("masks emails inside free text", () => {
    expect(redactString("lookup failed for ayse@example.com.tr today")).toBe("lookup failed for a***@example.com.tr today");
  });

  it.each([
    ["+90 555 123 45 67"],
    ["905551234567"],
    ["+905551234567"],
    ["0555 123 45 67"],
    ["(555) 123-4567"],
    ["+90 (555) 123 45 67"],
  ])("masks phone number %s inside free text", phone => {
    const result = redactString(`send to ${phone} failed`);
    expect(result).toBe("send to ***67 failed");
    expect(result).not.toContain("555");
  });

  it("leaves UUIDs and UUID-containing strings unchanged", () => {
    expect(redactString(UUID_VALUE)).toBe(UUID_VALUE);
    expect(redactString(`appointment ${UUID_VALUE} not found`)).toBe(`appointment ${UUID_VALUE} not found`);
    expect(redactString("12345678-1234-1234-1234-123456789012")).toBe("12345678-1234-1234-1234-123456789012");
    expect(redactString("tenant/12345678-1234-1234-1234-123456789012/staff")).toBe("tenant/12345678-1234-1234-1234-123456789012/staff");
  });

  it("leaves short numeric ids and status codes unchanged", () => {
    expect(redactString("HTTP 404 meta code 131026 subcode 2494010")).toBe("HTTP 404 meta code 131026 subcode 2494010");
    expect(redactString("WHATSAPP_PROVIDER_HTTP_404")).toBe("WHATSAPP_PROVIDER_HTTP_404");
  });

  it("masks JWTs in free text", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactString(`token was ${jwt} end`);
    expect(result).toBe(`token was ${REDACTED} end`);
    expect(result).not.toContain("eyJ");
  });

  it("masks Bearer and Basic credentials", () => {
    expect(redactString("Authorization: Bearer abc.DEF-123_xyz")).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactString("header Basic dXNlcjpwYXNz")).toBe(`header Basic ${REDACTED}`);
  });

  it("masks secret query parameters but keeps harmless ones", () => {
    const result = redactString("https://app.test/auth/callback#access_token=abc123&refresh_token=def456&type=recovery");
    expect(result).toBe(`https://app.test/auth/callback#access_token=${REDACTED}&refresh_token=${REDACTED}&type=recovery`);
    expect(redactString("?code=xyz&next=/admin")).toBe(`?code=${REDACTED}&next=/admin`);
  });

  it("masks connection string passwords", () => {
    const result = redactString("connect failed postgresql://postgres.abc:S3cr3t!pw@db.example.supabase.co:5432/postgres");
    expect(result).toBe(`connect failed postgresql://postgres.abc:${REDACTED}@db.example.supabase.co:5432/postgres`);
    expect(result).not.toContain("S3cr3t");
  });

  it("truncates very long strings", () => {
    const result = redactString("x".repeat(5000));
    expect(result.length).toBeLessThan(2100);
    expect(result.endsWith("…[truncated]")).toBe(true);
  });
});

describe("redactForLog", () => {
  it("masks values under email-like keys", () => {
    expect(redactForLog({ email: "ayse@example.com", customerEmail: "mehmet@example.org", mail: "x@y.io" })).toEqual({
      email: "a***@example.com",
      customerEmail: "m***@example.org",
      mail: "x***@y.io",
    });
  });

  it("masks values under phone-like keys, including numeric values", () => {
    expect(redactForLog({
      to: "+90 555 123 45 67",
      phone: "905551234567",
      customerPhone: "(555) 123-4567",
      from: 905551234567,
    })).toEqual({ to: "***67", phone: "***67", customerPhone: "***67", from: "***67" });
  });

  it("redacts non-scalar values under phone/email keys", () => {
    expect(redactForLog({ phone: { number: "905551234567" }, email: ["a@b.co"] })).toEqual({ phone: REDACTED, email: REDACTED });
  });

  it.each([
    ["accessToken"],
    ["refresh_token"],
    ["Authorization"],
    ["password"],
    ["SUPABASE_SERVICE_ROLE_KEY"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["databaseUrl"],
    ["DATABASE_URL"],
    ["apiKey"],
    ["webhookSecret"],
    ["cookie"],
  ])("redacts secret key %s", key => {
    expect(redactForLog({ [key]: "super-secret-value" })).toEqual({ [key]: REDACTED });
    expect(redactForLog({ [key]: { nested: "x" } })).toEqual({ [key]: REDACTED });
  });

  it("redacts content keys", () => {
    expect(redactForLog({
      body: "Merhaba Ayşe, randevunuz onaylandı",
      templateParameters: ["Saç Kesimi", "06.10.2026 14:00", "Ayşe"],
      notes: "allergic",
    })).toEqual({ body: REDACTED, templateParameters: REDACTED, notes: REDACTED });
  });

  it("keeps null, undefined and booleans under sensitive keys", () => {
    expect(redactForLog({ password: null, email: undefined, phone: false })).toEqual({ password: null, email: undefined, phone: false });
  });

  it("leaves ids, codes and UUIDs unchanged", () => {
    const context = {
      tenantId: UUID_VALUE,
      appointmentId: UUID_VALUE,
      status: 404,
      metaErrorCode: 131026,
      metaErrorSubcode: null,
      errorCode: "WHATSAPP_PROVIDER_HTTP_ERROR",
      templateKey: "appointment-confirmed-customer",
    };
    expect(redactForLog(context)).toEqual(context);
  });

  it("redacts nested objects and arrays", () => {
    expect(redactForLog({
      request: {
        headers: { Authorization: "Bearer abc" },
        payload: { to: "+905551112233", template: { components: [{ text: "Ayşe" }] } },
      },
      recipients: [{ profileId: UUID_VALUE, phone: "+905551112233" }, "contact ali@example.com"],
    })).toEqual({
      request: {
        headers: { Authorization: REDACTED },
        payload: { to: "***33", template: { components: [{ text: REDACTED }] } },
      },
      recipients: [{ profileId: UUID_VALUE, phone: "***33" }, "contact a***@example.com"],
    });
  });

  it("replaces circular references", () => {
    const context: Record<string, unknown> = { event: "x" };
    context.self = context;
    const list: unknown[] = [];
    list.push(list);
    expect(redactForLog(context)).toEqual({ event: "x", self: "[Circular]" });
    expect(redactForLog(list)).toEqual(["[Circular]"]);
  });

  it("caps nesting depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };
    expect(JSON.stringify(redactForLog(deep))).toContain("[MaxDepth]");
    expect(JSON.stringify(redactForLog(deep))).not.toContain("too deep");
  });

  it("serializes Error objects to name/message/code without stack", () => {
    const error = Object.assign(new Error("send to +905551112233 failed for ayse@example.com"), { code: "P2002" });
    const result = redactForLog({ error });
    expect(result).toEqual({
      error: { name: "Error", message: "send to ***33 failed for a***@example.com", code: "P2002" },
    });
    expect(JSON.stringify(result)).not.toContain("at ");
    expect((result as { error: Record<string, unknown> }).error).not.toHaveProperty("stack");
  });

  it("drops non-scalar error codes", () => {
    const error = Object.assign(new TypeError("boom"), { code: { secret: "x" } });
    expect(redactForLog(error)).toEqual({ name: "TypeError", message: "boom" });
  });

  it("handles primitives, dates, bigint and functions", () => {
    expect(redactForLog(404)).toBe(404);
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog(undefined)).toBeUndefined();
    expect(redactForLog(BigInt(10))).toBe("10");
    expect(redactForLog(() => 1)).toBe("[function]");
    expect(redactForLog(new Date("2026-10-06T11:00:00.000Z"))).toBe("2026-10-06T11:00:00.000Z");
  });

  it("does not mutate the input", () => {
    const input = {
      to: "+905551112233",
      accessToken: "secret",
      nested: { email: "ayse@example.com", list: ["call 905551234567"] },
    };
    const snapshot = structuredClone(input);
    const result = redactForLog(input);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect((result as { nested: unknown }).nested).not.toBe(input.nested);
  });
});

describe("logError", () => {
  it("calls console.error with a redacted context", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("notification_send_failed", { to: "+905551112233", accessToken: "secret", tenantId: UUID_VALUE });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("notification_send_failed", {
      to: "***33",
      accessToken: REDACTED,
      tenantId: UUID_VALUE,
    });
  });

  it("passes an already-safe provider error context through unchanged", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = {
      status: 400,
      metaErrorCode: 131026,
      metaErrorSubcode: null,
      errorCode: "WHATSAPP_PROVIDER_HTTP_ERROR",
    };
    logError("whatsapp_provider_http_error", context);
    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_http_error", context);
  });

  it("passes the notification_delivery_unknown context through unchanged", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = {
      tenantId: UUID_VALUE,
      appointmentId: "223e4567-e89b-12d3-a456-426614174001",
      channel: "WHATSAPP",
      recipientProfileId: "323e4567-e89b-12d3-a456-426614174002",
      errorCode: "PROVIDER_OUTCOME_UNKNOWN",
    };
    logError("notification_delivery_unknown", context);
    expect(consoleError).toHaveBeenCalledWith("notification_delivery_unknown", context);
  });

  it("logs only the event when no context is given", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("whatsapp_provider_network_error");
    expect(consoleError).toHaveBeenCalledWith("whatsapp_provider_network_error");
    expect(consoleError.mock.calls[0]).toHaveLength(1);
  });

  it("redacts the event string too", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("failed for ayse@example.com");
    expect(consoleError).toHaveBeenCalledWith("failed for a***@example.com");
  });
});

describe("false positives and shared references", () => {
  it("keeps date-time strings that look like digit runs", () => {
    expect(redactString("slot 06.10.2026 14:00 taken")).toBe("slot 06.10.2026 14:00 taken");
    expect(redactString("slot 2026-10-06 14:00 taken")).toBe("slot 2026-10-06 14:00 taken");
    expect(redactString("call 0555-123-45-67 now")).toBe("call ***67 now");
  });

  it("logs an object shared by two keys in full both times", () => {
    const shared = { status: 404 };
    expect(redactForLog({ a: shared, b: shared })).toEqual({ a: { status: 404 }, b: { status: 404 } });
  });

  it("does not throw on an invalid Date", () => {
    expect(redactForLog({ at: new Date(Number.NaN) })).toEqual({ at: "[Invalid Date]" });
  });
});

describe("logError never throws", () => {
  it("falls back to [unloggable] when the context cannot be read", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile = new Proxy({}, { ownKeys() { throw new Error("boom"); } });
    const withGetter = Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("boom"); } });
    expect(() => logError("event_a", hostile as Record<string, unknown>)).not.toThrow();
    expect(() => logError("event_b", withGetter as Record<string, unknown>)).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith("event_a", "[unloggable]");
    expect(consoleError).toHaveBeenCalledWith("event_b", "[unloggable]");
  });
});

describe("logInfo", () => {
  it("calls console.info (not console.error) with a redacted context", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logInfo("customer_appointment_cancelled", {
      tenantId: UUID_VALUE, appointmentId: "appt-1", actorKind: "customer_token",
      accessToken: "raw-token-value", email: "ayse@example.com", phone: "+905551112233",
    });
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(consoleInfo).toHaveBeenCalledWith("customer_appointment_cancelled", {
      tenantId: UUID_VALUE, appointmentId: "appt-1", actorKind: "customer_token",
      accessToken: REDACTED, email: "a***@example.com", phone: "***33",
    });
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("raw-token-value");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs only the event when no context is given and redacts the event string", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("customer_appointment_cancelled");
    logInfo("cancelled for ayse@example.com");
    expect(consoleInfo.mock.calls[0]).toEqual(["customer_appointment_cancelled"]);
    expect(consoleInfo.mock.calls[1]).toEqual(["cancelled for a***@example.com"]);
  });

  it("never throws: unreadable context falls back to [unloggable]", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const hostile = new Proxy({}, { ownKeys() { throw new Error("boom"); } });
    expect(() => logInfo("event_a", hostile as Record<string, unknown>)).not.toThrow();
    expect(consoleInfo).toHaveBeenCalledWith("event_a", "[unloggable]");
  });

  it("never throws even when console.info itself throws", () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("stdout closed"); });
    expect(() => logInfo("event_b", { appointmentId: "appt-1" })).not.toThrow();
  });
});

describe("Web Push subscription fields (WP-09)", () => {
  it("redacts endpoint, p256dh and auth values", () => {
    expect(redactForLog({ endpoint: "https://push.example.com/device", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) }, status: 410 }))
      .toEqual({ endpoint: REDACTED, keys: { p256dh: REDACTED, auth: REDACTED }, status: 410 });
  });
});

describe("Web Push logError output (WP-09 QA)", () => {
  it("never prints endpoint or key values through logError", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("web_push_test_event", { endpoint: "https://fcm.googleapis.com/fcm/send/device-secret", p256dh: "B".repeat(87), auth: "z".repeat(22), status: 410 });
    const printed = JSON.stringify(spy.mock.calls);
    expect(printed).not.toContain("device-secret");
    expect(printed).not.toContain("B".repeat(87));
    expect(printed).not.toContain("z".repeat(22));
    expect(printed).toContain("410");
    spy.mockRestore();
  });
});
