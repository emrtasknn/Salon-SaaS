import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingEngine, type AppointmentCreateScope } from "./booking-engine";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { STAFF_VERBAL_OPTIN, renderStaffVerbalOptIn } from "../domain/legal-notice";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

const availabilityDate = nextMondayIso();
const identity = createAuthenticatedIdentity("u", "p");
const tenant = { tenantId: "t" as never };
const service = { id: "svc", tenantId: "t", name: "Cut", durationMinutes: 60, bufferMinutes: 15, active: true };
const staff = { id: "staff", tenantId: "t", profileId: "p2", status: "ACTIVE" as const };
const hours = [{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }];
const nineAm = localWallTimeToUtc(availabilityDate, 9 * 60, "Europe/Istanbul");
const guest = { kind: "guest", displayName: "Guest", phone: "0555 111 22 33" };

function bookingContext(overrides: Record<string, unknown> = {}) {
  return {
    service, staff, workingHours: hours, appointments: [], timezone: "Europe/Istanbul",
    tenantStatus: "ACTIVE" as const, dateIso: availabilityDate, closedDates: [] as string[], ...overrides,
  };
}

const repository = {
  getBookingContext: vi.fn(),
  getCreateOptions: vi.fn(),
  createAppointment: vi.fn(),
  transition: vi.fn(),
  rescheduleAppointment: vi.fn(),
};
const authorizer = {
  authorize: vi.fn(),
  authorizeStaffDecision: vi.fn(),
  authorizeStaffCompletion: vi.fn(),
  resolveCreateScope: vi.fn<() => Promise<AppointmentCreateScope | null>>(),
};
const engine = () => createBookingEngine({ repository, authorizer });

beforeEach(() => {
  vi.clearAllMocks();
  repository.getBookingContext.mockResolvedValue(bookingContext());
  repository.getCreateOptions.mockResolvedValue({ timezone: "Europe/Istanbul", services: [], staff: [] });
  repository.createAppointment.mockResolvedValue({ status: "created", appointmentId: "a1", customerWhatsAppOptIn: false });
  repository.transition.mockResolvedValue("updated");
  repository.rescheduleAppointment.mockImplementation(async (_t: unknown, input: { startAt: Date }) => ({
    status: "rescheduled", startAt: input.startAt, endAt: new Date(input.startAt.getTime() + 75 * 60_000),
  }));
  authorizer.authorize.mockResolvedValue(true);
  authorizer.authorizeStaffDecision.mockResolvedValue(true);
  authorizer.authorizeStaffCompletion.mockResolvedValue(false);
  authorizer.resolveCreateScope.mockResolvedValue({ kind: "admin" });
});

describe("booking engine", () => {
  it("calculates availability from server-owned resources", async () => {
    const result = await engine().availability(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
    expect(result.status).toBe("ok");
    expect(result.slots.length).toBeGreaterThan(0);
    expect(repository.getBookingContext).toHaveBeenCalledWith(tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
  });

  it("availability returns no slots on a closed date", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ closedDates: [availabilityDate] }));
    const result = await engine().availability(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
    expect(result).toEqual({ status: "ok", slots: [] });
  });

  it("the unbound CUSTOMER-authorized create path is retired", () => {
    expect("create" in engine()).toBe(false);
  });

  it("uses staff decision authorization for confirm/reject", async () => {
    const appointment = { id: "a", tenantId: "t", staffId: "staff", serviceId: "svc", customerProfileId: "p",
      startAt: new Date("2026-10-05T06:00:00.000Z"), endAt: new Date("2026-10-05T07:15:00.000Z"), status: "PENDING" as const };
    await engine().transition(identity, tenant, appointment, "CONFIRMED");
    expect(authorizer.authorizeStaffDecision).toHaveBeenCalled();
  });
});

describe("createOnBehalf (WP-08)", () => {
  describe("authorization matrix", () => {
    it("denies callers without a create scope (CUSTOMER / unknown) before any read", async () => {
      authorizer.resolveCreateScope.mockResolvedValue(null);
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest });
      expect(result).toEqual({ status: "FORBIDDEN" });
      expect(repository.getBookingContext).not.toHaveBeenCalled();
      expect(repository.createAppointment).not.toHaveBeenCalled();
    });

    it("TENANT_ADMIN may create for any staff of the tenant", async () => {
      repository.getBookingContext.mockResolvedValue(bookingContext({ staff: { ...staff, id: "other-staff" } }));
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "other-staff", startAt: nineAm, customer: guest });
      expect(result.status).toBe("CREATED");
      expect(repository.createAppointment).toHaveBeenCalledWith(tenant, expect.objectContaining({ staffId: "other-staff" }));
    });

    it("TENANT_ADMIN must name a staff member", async () => {
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", startAt: nineAm, customer: guest });
      expect(result).toEqual({ status: "INVALID_INPUT" });
    });

    it("STAFF cannot create for another staffId", async () => {
      authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "other-staff", startAt: nineAm, customer: guest });
      expect(result).toEqual({ status: "FORBIDDEN" });
      expect(repository.getBookingContext).not.toHaveBeenCalled();
      expect(repository.createAppointment).not.toHaveBeenCalled();
    });

    it("STAFF without a staffId creates for their server-derived own staffId", async () => {
      authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", startAt: nineAm, customer: guest });
      expect(result.status).toBe("CREATED");
      expect(repository.getBookingContext).toHaveBeenCalledWith(tenant, { serviceId: "svc", staffId: "staff", at: nineAm });
      expect(repository.createAppointment).toHaveBeenCalledWith(tenant, expect.objectContaining({ staffId: "staff" }));
    });

    it("STAFF cannot pick an existing CRM customer (decision e)", async () => {
      authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", startAt: nineAm, customer: { kind: "existing", profileId: "c1" } });
      expect(result).toEqual({ status: "FORBIDDEN" });
      expect(repository.createAppointment).not.toHaveBeenCalled();
    });

    it("STAFF guest form has no email field", async () => {
      authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", startAt: nineAm, customer: { ...guest, email: "g@example.com" } });
      expect(result).toEqual({ status: "INVALID_INPUT" });
    });

    it("TENANT_ADMIN may use an existing customer (verified by persistence)", async () => {
      await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: { kind: "existing", profileId: "c1" } });
      expect(repository.createAppointment).toHaveBeenCalledWith(tenant, expect.objectContaining({ customer: { kind: "existing", profileId: "c1" } }));
    });
  });

  it("creates CONFIRMED with an access-token hash and returns the raw token only to the caller", async () => {
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: { ...guest, email: " g@example.com " } });
    expect(result).toMatchObject({ status: "CREATED", appointmentId: "a1", customerWhatsAppOptIn: false });
    const call = repository.createAppointment.mock.calls[0][1];
    expect(call.initialStatus).toBe("CONFIRMED");
    expect(call.customer).toEqual({ kind: "guest", displayName: "Guest", email: "g@example.com", phone: "+905551112233" });
    expect(call.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call).not.toHaveProperty("endAt");
    expect(call.contact).toEqual({ whatsappVerbalOptIn: false, recordedByProfileId: "p" });
  });

  it("rejects malformed guest input", async () => {
    for (const customer of [{ kind: "guest", displayName: "  " }, { kind: "guest", displayName: "G", phone: "abc" }, { kind: "guest", displayName: "G", email: "nope" }, { kind: "vip" }, null]) {
      await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer })).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("requires current server-side availability before creating (past slot)", async () => {
    const pastDateIso = addDaysToDateIso(availabilityDate, -7);
    const startAt = localWallTimeToUtc(pastDateIso, 9 * 60, "Europe/Istanbul");
    repository.getBookingContext.mockResolvedValue(bookingContext({ dateIso: pastDateIso }));
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt, customer: guest });
    expect(result).toEqual({ status: "SLOT_UNAVAILABLE" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("rejects a start outside working hours", async () => {
    const startAt = localWallTimeToUtc(availabilityDate, 17 * 60, "Europe/Istanbul");
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt, customer: guest });
    expect(result).toEqual({ status: "SLOT_UNAVAILABLE" });
  });

  it("rejects a closed date with CLOSED_DATE before persistence", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ closedDates: [availabilityDate] }));
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest });
    expect(result).toEqual({ status: "CLOSED_DATE" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("surfaces TENANT_INACTIVE from context and from the persistence gate", async () => {
    repository.getBookingContext.mockResolvedValueOnce(bookingContext({ tenantStatus: "INACTIVE" }));
    await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest })).resolves.toEqual({ status: "TENANT_INACTIVE" });
    repository.createAppointment.mockResolvedValueOnce("tenant_inactive");
    await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest })).resolves.toEqual({ status: "TENANT_INACTIVE" });
  });

  it("maps persistence outcomes", async () => {
    const cases: Array<[unknown, unknown]> = [
      ["conflict", { status: "SLOT_UNAVAILABLE" }],
      ["slot_unavailable", { status: "SLOT_UNAVAILABLE" }],
      ["closed_date", { status: "CLOSED_DATE" }],
      ["customer_not_found", { status: "CUSTOMER_NOT_FOUND" }],
      ["invalid_resource", { status: "INVALID_RESOURCE" }],
      ["persistence_failure", { status: "PERSISTENCE_FAILURE" }],
      [{ status: "email_exists", existing: { profileId: "c1", displayName: "C", phone: null, email: "g@example.com" } },
        { status: "EMAIL_EXISTS", existing: { profileId: "c1", displayName: "C", phone: null, email: "g@example.com" } }],
    ];
    for (const [persisted, expected] of cases) {
      repository.createAppointment.mockResolvedValueOnce(persisted);
      await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest })).resolves.toEqual(expected);
    }
  });
});

describe("slotsOnBehalf / createOptions (WP-08)", () => {
  it("returns CLOSED_DATE for a closed day and OK slots otherwise", async () => {
    repository.getBookingContext.mockResolvedValueOnce(bookingContext({ closedDates: [availabilityDate] }));
    await expect(engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate }))
      .resolves.toMatchObject({ status: "CLOSED_DATE" });
    const ok = await engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
    expect(ok.status).toBe("OK");
  });

  it("STAFF slot listing is bound to their own staffId", async () => {
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
    await expect(engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "other", dateIso: availabilityDate })).resolves.toEqual({ status: "FORBIDDEN" });
    await engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", dateIso: availabilityDate });
    expect(repository.getBookingContext).toHaveBeenCalledWith(tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
  });

  it("create options: admin unrestricted, staff restricted to self, others forbidden", async () => {
    await engine().createOptions(identity, tenant);
    expect(repository.getCreateOptions).toHaveBeenLastCalledWith(tenant, { staffId: null });
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
    await engine().createOptions(identity, tenant);
    expect(repository.getCreateOptions).toHaveBeenLastCalledWith(tenant, { staffId: "staff" });
    authorizer.resolveCreateScope.mockResolvedValue(null);
    await expect(engine().createOptions(identity, tenant)).resolves.toEqual({ status: "FORBIDDEN" });
  });
});

// QA (WP-08): extra authz + closure-boundary cases for createOnBehalf.
describe("createOnBehalf QA additions (WP-08)", () => {
  const nextDay = addDaysToDateIso(availabilityDate, 1);
  const lateHours = [{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 540, closeMinute: 1440 }];

  it("TENANT_ADMIN cannot target an INACTIVE staff member", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ staff: { ...staff, status: "INACTIVE" } }));
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest });
    expect(result).toEqual({ status: "INVALID_RESOURCE" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("rejects an inactive service", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ service: { ...service, active: false } }));
    await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest }))
      .resolves.toEqual({ status: "INVALID_RESOURCE" });
  });

  it("STAFF cannot target another staffId via case variants, blanks or non-strings", async () => {
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
    for (const staffId of ["STAFF", "staff2", "", 42]) {
      const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId, startAt: nineAm, customer: guest });
      expect(result).toEqual({ status: "FORBIDDEN" });
    }
    expect(repository.getBookingContext).not.toHaveBeenCalled();
  });

  it("rejects a slot whose buffer crosses local midnight into a closed next date (owner decision)", async () => {
    // 23:00 Istanbul + 60 min + 15 min buffer -> 00:15 on the closed next day.
    const startAt = localWallTimeToUtc(availabilityDate, 23 * 60, "Europe/Istanbul");
    repository.getBookingContext.mockResolvedValue(bookingContext({ workingHours: lateHours, closedDates: [nextDay] }));
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt, customer: guest });
    expect(result).toEqual({ status: "CLOSED_DATE" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("a slot ending exactly at local midnight before a closed date is allowed (open day unaffected)", async () => {
    const startAt = localWallTimeToUtc(availabilityDate, 22 * 60 + 45, "Europe/Istanbul");
    repository.getBookingContext.mockResolvedValue(bookingContext({ workingHours: lateHours, closedDates: [nextDay] }));
    const result = await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt, customer: guest });
    expect(result.status).toBe("CREATED");
    expect(repository.createAppointment).toHaveBeenCalledWith(tenant, expect.objectContaining({ startAt, initialStatus: "CONFIRMED" }));
  });

  it("STAFF-created appointments also start CONFIRMED", async () => {
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
    await engine().createOnBehalf(identity, tenant, { serviceId: "svc", startAt: nineAm, customer: guest });
    expect(repository.createAppointment.mock.calls[0][1].initialStatus).toBe("CONFIRMED");
  });

  it("slotsOnBehalf: CUSTOMER / unknown callers are denied before any read", async () => {
    authorizer.resolveCreateScope.mockResolvedValue(null);
    await expect(engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate })).resolves.toEqual({ status: "FORBIDDEN" });
    expect(repository.getBookingContext).not.toHaveBeenCalled();
  });
});

// QA (WP-11): an INACTIVE tenant exposes no slots on the staff/admin path either.
describe("slotsOnBehalf inactive tenant (WP-11)", () => {
  it("returns TENANT_INACTIVE without slots, even on an otherwise bookable day", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ tenantStatus: "INACTIVE" }));
    const result = await engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
    expect(result).toEqual({ status: "TENANT_INACTIVE" });
    expect(result).not.toHaveProperty("slots");
  });

  it("checks tenant status before the closed-date short-circuit", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ tenantStatus: "INACTIVE", closedDates: [availabilityDate] }));
    await expect(engine().slotsOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate }))
      .resolves.toEqual({ status: "TENANT_INACTIVE" });
  });
});

describe("verbal WhatsApp opt-in (WP-10)", () => {
  it("passes the opt-in with the acting user's server-derived profile as recorder", async () => {
    await engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest, whatsappVerbalOptIn: true });
    expect(repository.createAppointment.mock.calls[0][1].contact).toEqual({ whatsappVerbalOptIn: true, recordedByProfileId: "p" });
  });

  it("guest without a phone -> OPT_IN_REQUIRES_PHONE before persistence", async () => {
    const result = await engine().createOnBehalf(identity, tenant, {
      serviceId: "svc", staffId: "staff", startAt: nineAm, customer: { kind: "guest", displayName: "Guest" }, whatsappVerbalOptIn: true,
    });
    expect(result).toEqual({ status: "OPT_IN_REQUIRES_PHONE" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("maps persistence opt_in_requires_phone (existing customer without E.164 phone)", async () => {
    repository.createAppointment.mockResolvedValueOnce("opt_in_requires_phone");
    await expect(engine().createOnBehalf(identity, tenant, {
      serviceId: "svc", staffId: "staff", startAt: nineAm, customer: { kind: "existing", profileId: "c1" }, whatsappVerbalOptIn: true,
    })).resolves.toEqual({ status: "OPT_IN_REQUIRES_PHONE" });
  });

  it("rejects a non-boolean opt-in flag", async () => {
    await expect(engine().createOnBehalf(identity, tenant, { serviceId: "svc", staffId: "staff", startAt: nineAm, customer: guest, whatsappVerbalOptIn: "yes" }))
      .resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("create options carry the verbal opt-in template label/version", async () => {
    const result = await engine().createOptions(identity, tenant);
    expect(result).toMatchObject({ status: "OK", options: { verbalOptIn: { version: STAFF_VERBAL_OPTIN.version, label: renderStaffVerbalOptIn() } } });
  });
});

describe("booking engine reschedule (owner decision 2026-11-05)", () => {
  const tenAm = localWallTimeToUtc(availabilityDate, 10 * 60, "Europe/Istanbul");
  const appointment = { id: "a1", tenantId: "t", staffId: "staff", serviceId: "svc", customerProfileId: "c",
    startAt: nineAm, endAt: new Date(nineAm.getTime() + 75 * 60_000), status: "CONFIRMED" as const };

  it("lets an admin move an open appointment to a free slot (own old slot is not a conflict)", async () => {
    repository.getBookingContext.mockResolvedValue(bookingContext({ appointments: [appointment] }));
    const result = await engine().reschedule(identity, tenant, appointment, tenAm);
    expect(result).toMatchObject({ status: "RESCHEDULED", startAt: tenAm });
    expect(repository.rescheduleAppointment).toHaveBeenCalledWith(tenant, {
      appointmentId: "a1", staffId: "staff", serviceId: "svc", expectedStartAt: nineAm, startAt: tenAm,
    });
  });

  it("lets staff move only their own appointments", async () => {
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "other-staff" });
    expect(await engine().reschedule(identity, tenant, appointment, tenAm)).toEqual({ status: "FORBIDDEN" });
    authorizer.resolveCreateScope.mockResolvedValue({ kind: "staff", staffId: "staff" });
    expect((await engine().reschedule(identity, tenant, appointment, tenAm)).status).toBe("RESCHEDULED");
  });

  it("rejects callers without a create scope (e.g. inactive staff, customers)", async () => {
    authorizer.resolveCreateScope.mockResolvedValue(null);
    expect(await engine().reschedule(identity, tenant, appointment, tenAm)).toEqual({ status: "FORBIDDEN" });
    expect(repository.rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("never moves terminal appointments", async () => {
    for (const status of ["CANCELLED", "REJECTED", "COMPLETED"] as const) {
      expect(await engine().reschedule(identity, tenant, { ...appointment, status }, tenAm)).toEqual({ status: "INVALID_STATUS" });
    }
  });

  it("refuses a start that overlaps another appointment", async () => {
    const other = { ...appointment, id: "a2", startAt: tenAm, endAt: new Date(tenAm.getTime() + 75 * 60_000) };
    repository.getBookingContext.mockResolvedValue(bookingContext({ appointments: [appointment, other] }));
    expect(await engine().reschedule(identity, tenant, appointment, tenAm)).toEqual({ status: "SLOT_UNAVAILABLE" });
  });

  it("refuses times outside working hours and closed days", async () => {
    const tenPm = localWallTimeToUtc(availabilityDate, 22 * 60, "Europe/Istanbul");
    expect(await engine().reschedule(identity, tenant, appointment, tenPm)).toEqual({ status: "SLOT_UNAVAILABLE" });
    repository.getBookingContext.mockResolvedValue(bookingContext({ closedDates: [availabilityDate] }));
    expect(await engine().reschedule(identity, tenant, appointment, tenAm)).toEqual({ status: "CLOSED_DATE" });
  });

  it("maps a concurrent change in the transaction to STALE", async () => {
    repository.rescheduleAppointment.mockResolvedValue("stale");
    expect(await engine().reschedule(identity, tenant, appointment, tenAm)).toEqual({ status: "STALE" });
  });

  it("treats the same start as a no-op without writing", async () => {
    expect((await engine().reschedule(identity, tenant, appointment, nineAm)).status).toBe("RESCHEDULED");
    expect(repository.rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    expect(await engine().reschedule(identity, tenant, appointment, "10:00")).toEqual({ status: "INVALID_INPUT" });
  });
});

describe("completion (owner decision 2026-11-06)", () => {
  const startAt = new Date("2026-11-07T08:00:00.000Z");
  const confirmed = { id: "a", tenantId: "t", staffId: "staff", serviceId: "svc", customerProfileId: "p",
    startAt, endAt: new Date("2026-11-07T09:00:00.000Z"), status: "CONFIRMED" as const };
  const at = (iso: string) => createBookingEngine({ repository, authorizer, now: () => new Date(iso) });

  it("refuses to complete before the start time and never writes", async () => {
    const result = await at("2026-11-07T07:00:00.000Z").transition(identity, tenant, confirmed, "COMPLETED");
    expect(result).toEqual({ status: "NOT_STARTED" });
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it("checks authorization before the time rule", async () => {
    authorizer.authorize.mockResolvedValue(false);
    const result = await at("2026-11-07T07:00:00.000Z").transition(identity, tenant, confirmed, "COMPLETED");
    expect(result).toEqual({ status: "UNAUTHORIZED" });
  });

  it("lets a tenant admin complete once the appointment has started", async () => {
    const result = await at("2026-11-07T08:00:00.000Z").transition(identity, tenant, confirmed, "COMPLETED");
    expect(result).toEqual({ status: "updated" });
    expect(repository.transition).toHaveBeenCalledWith(tenant, "a", "CONFIRMED", "COMPLETED");
  });

  it("lets the assigned staff member complete through the staff completion boundary", async () => {
    authorizer.authorize.mockResolvedValue(false);
    authorizer.authorizeStaffCompletion.mockResolvedValue(true);
    const result = await at("2026-11-07T09:30:00.000Z").transition(identity, tenant, confirmed, "COMPLETED");
    expect(result).toEqual({ status: "updated" });
    expect(authorizer.authorizeStaffCompletion).toHaveBeenCalledWith(identity, tenant, confirmed);
  });

  it("denies staff who fail the completion boundary", async () => {
    authorizer.authorize.mockResolvedValue(false);
    const result = await at("2026-11-07T09:30:00.000Z").transition(identity, tenant, confirmed, "COMPLETED");
    expect(result).toEqual({ status: "UNAUTHORIZED" });
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it("staff completion never authorizes cancelling", async () => {
    authorizer.authorize.mockResolvedValue(false);
    authorizer.authorizeStaffCompletion.mockResolvedValue(true);
    const result = await at("2026-11-07T09:30:00.000Z").transition(identity, tenant, confirmed, "CANCELLED");
    expect(result).toEqual({ status: "UNAUTHORIZED" });
  });
});
