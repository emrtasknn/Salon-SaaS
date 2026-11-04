import { beforeEach, describe, expect, it, vi } from "vitest";

// WP-08 QA: create-on-behalf runtime wiring. Notification publish happens only after a CREATED
// result, only when notifyCustomer is true and the customer has a phone, and "notified" is true
// only for a SENT provider result (UNKNOWN / FAILED / NOT_CONFIGURED -> false, never retried here).
const { publishAppointmentNotification } = vi.hoisted(() => ({ publishAppointmentNotification: vi.fn() }));
vi.mock("./notification-runtime", () => ({ publishAppointmentNotification }));

import { createOnBehalf, listSlotsOnBehalf, readCreateOptions } from "./appointment-create-runtime";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const identity = createAuthenticatedIdentity("user-1", "profile-1");
const tenantContext = { tenantId: "tenant-from-session" as never };
const startIso = "2026-11-09T06:00:00.000Z";
const guest = { kind: "guest", displayName: "Guest", phone: "+905551112233" };

const engine = {
  createOnBehalf: vi.fn(),
  slotsOnBehalf: vi.fn(),
  createOptions: vi.fn(),
};
type Engine = Parameters<typeof createOnBehalf>[0];
const asEngine = () => engine as unknown as Engine;

beforeEach(() => {
  vi.clearAllMocks();
  engine.createOnBehalf.mockResolvedValue({ status: "CREATED", appointmentId: "a1", customerPhone: "+905551112233", accessToken: "raw" });
  publishAppointmentNotification.mockResolvedValue({ status: "processed", results: [{ profileId: "c", status: "SENT", channel: "WHATSAPP" }] });
});

function create(overrides: Record<string, unknown> = {}) {
  return createOnBehalf(asEngine(), identity, tenantContext, {
    serviceId: "svc", staffId: "staff", startAt: startIso, customer: guest, notifyCustomer: true, ...overrides,
  });
}

describe("createOnBehalf runtime (WP-08)", () => {
  it("passes the server tenant context and a parsed Date to the engine, and never returns the raw access token", async () => {
    const result = await create();
    expect(engine.createOnBehalf).toHaveBeenCalledWith(identity, tenantContext, {
      serviceId: "svc", staffId: "staff", startAt: new Date(startIso), customer: guest,
    });
    expect(result).toEqual({ status: "CREATED", appointmentId: "a1", notified: true });
    expect(JSON.stringify(result)).not.toContain("raw");
  });

  it("publishes APPOINTMENT_CONFIRMED for the created appointment in the same tenant", async () => {
    await create();
    expect(publishAppointmentNotification).toHaveBeenCalledOnce();
    expect(publishAppointmentNotification).toHaveBeenCalledWith(tenantContext, "a1", "APPOINTMENT_CONFIRMED");
  });

  it("notifyCustomer=false -> no publish", async () => {
    await expect(create({ notifyCustomer: false })).resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: false });
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });

  it("customer without phone -> no publish even when notifyCustomer is true", async () => {
    engine.createOnBehalf.mockResolvedValue({ status: "CREATED", appointmentId: "a1", customerPhone: null, accessToken: "raw" });
    await expect(create()).resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: false });
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["UNKNOWN provider outcome", { status: "processed", results: [{ profileId: "c", status: "UNKNOWN" }] }],
    ["FAILED provider outcome", { status: "processed", results: [{ profileId: "c", status: "FAILED" }] }],
    ["no recipients", { status: "processed", results: [] }],
    ["provider not configured", { status: "NOT_CONFIGURED" }],
    ["publish failure", { status: "FAILED" }],
  ])("%s -> appointment still CREATED, notified=false, published exactly once", async (_label, published) => {
    publishAppointmentNotification.mockResolvedValue(published);
    await expect(create()).resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: false });
    expect(publishAppointmentNotification).toHaveBeenCalledOnce();
  });

  it("counts only a WhatsApp SENT as notified; a staff/admin Web Push SENT never does (WP-09 B1)", async () => {
    // WhatsApp env missing + push configured: only WEB_PUSH results can come back.
    publishAppointmentNotification.mockResolvedValue({ status: "processed", results: [{ profileId: "admin-1", status: "SENT", channel: "WEB_PUSH" }] });
    await expect(create()).resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: false });
    publishAppointmentNotification.mockResolvedValue({ status: "processed", results: [
      { profileId: "admin-1", status: "SENT", channel: "WEB_PUSH" },
      { profileId: "c", status: "SENT", channel: "WHATSAPP" },
    ] });
    await expect(create()).resolves.toEqual({ status: "CREATED", appointmentId: "a1", notified: true });
  });

  it("does not publish for any non-CREATED outcome", async () => {
    for (const status of ["SLOT_UNAVAILABLE", "CLOSED_DATE", "TENANT_INACTIVE", "CUSTOMER_NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"]) {
      engine.createOnBehalf.mockResolvedValueOnce({ status });
      await expect(create()).resolves.toEqual({ status });
    }
    engine.createOnBehalf.mockResolvedValueOnce({ status: "EMAIL_EXISTS", existing: { profileId: "c1", displayName: "C", phone: null, email: "c@example.com" } });
    await expect(create()).resolves.toMatchObject({ status: "EMAIL_EXISTS" });
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });

  it("maps INVALID_RESOURCE -> INVALID_INPUT and PERSISTENCE_FAILURE -> SLOT_UNAVAILABLE", async () => {
    engine.createOnBehalf.mockResolvedValueOnce({ status: "INVALID_RESOURCE" });
    await expect(create()).resolves.toEqual({ status: "INVALID_INPUT" });
    engine.createOnBehalf.mockResolvedValueOnce({ status: "PERSISTENCE_FAILURE" });
    await expect(create()).resolves.toEqual({ status: "SLOT_UNAVAILABLE" });
  });

  it("rejects malformed startAt / notifyCustomer before calling the engine", async () => {
    for (const overrides of [{ startAt: "not-a-date" }, { startAt: 123 }, { startAt: "x".repeat(41) }, { notifyCustomer: "true" }, { notifyCustomer: undefined }]) {
      await expect(create(overrides)).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(engine.createOnBehalf).not.toHaveBeenCalled();
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });
});

describe("listSlotsOnBehalf / readCreateOptions runtime (WP-08)", () => {
  it("labels slots in the tenant timezone and passes status through", async () => {
    engine.slotsOnBehalf.mockResolvedValueOnce({ status: "OK", timezone: "Europe/Istanbul", slots: [{ startAt: new Date("2026-11-09T22:00:00.000Z"), endAt: new Date("2026-11-09T23:00:00.000Z") }] });
    await expect(listSlotsOnBehalf(asEngine(), identity, tenantContext, { serviceId: "svc", staffId: "staff", date: "2026-11-10" }))
      .resolves.toEqual({ status: "OK", slots: [{ startAt: "2026-11-09T22:00:00.000Z", label: "01:00" }] });
    expect(engine.slotsOnBehalf).toHaveBeenCalledWith(identity, tenantContext, { serviceId: "svc", staffId: "staff", dateIso: "2026-11-10" });
    engine.slotsOnBehalf.mockResolvedValueOnce({ status: "CLOSED_DATE", timezone: "Europe/Istanbul" });
    await expect(listSlotsOnBehalf(asEngine(), identity, tenantContext, { serviceId: "svc", date: "2026-11-10" })).resolves.toEqual({ status: "CLOSED_DATE" });
  });

  it("returns null create options when forbidden", async () => {
    engine.createOptions.mockResolvedValueOnce({ status: "FORBIDDEN" });
    await expect(readCreateOptions(asEngine(), identity, tenantContext)).resolves.toBeNull();
  });
});
