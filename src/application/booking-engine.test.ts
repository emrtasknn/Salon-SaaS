import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingEngine, type AppointmentCreateScope } from "./booking-engine";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
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
};
const authorizer = {
  authorize: vi.fn(),
  authorizeStaffDecision: vi.fn(),
  resolveCreateScope: vi.fn<() => Promise<AppointmentCreateScope | null>>(),
};
const engine = () => createBookingEngine({ repository, authorizer });

beforeEach(() => {
  vi.clearAllMocks();
  repository.getBookingContext.mockResolvedValue(bookingContext());
  repository.getCreateOptions.mockResolvedValue({ timezone: "Europe/Istanbul", services: [], staff: [] });
  repository.createAppointment.mockResolvedValue({ status: "created", appointmentId: "a1", customerPhone: "+905551112233" });
  repository.transition.mockResolvedValue("updated");
  authorizer.authorize.mockResolvedValue(true);
  authorizer.authorizeStaffDecision.mockResolvedValue(true);
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
    expect(result).toMatchObject({ status: "CREATED", appointmentId: "a1", customerPhone: "+905551112233" });
    const call = repository.createAppointment.mock.calls[0][1];
    expect(call.initialStatus).toBe("CONFIRMED");
    expect(call.customer).toEqual({ kind: "guest", displayName: "Guest", email: "g@example.com", phone: "+905551112233" });
    expect(call.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call).not.toHaveProperty("endAt");
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
