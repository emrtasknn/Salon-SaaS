import { describe, expect, it, vi } from "vitest";
import { createBookingEngine } from "./booking-engine";
import { createAuthenticatedIdentity } from "../domain/auth-identity";
import { localWallTimeToUtc } from "../domain/availability";

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
const repository = {
  getBookingContext: vi.fn().mockResolvedValue({ service, staff, workingHours: hours, appointments: [], timezone: "Europe/Istanbul" }),
  createAppointment: vi.fn().mockResolvedValue("created"),
  transition: vi.fn().mockResolvedValue("updated"),
};
const authorizer = { authorize: vi.fn().mockResolvedValue(true), authorizeStaffDecision: vi.fn().mockResolvedValue(true) };

describe("booking engine", () => {
  it("calculates availability from server-owned resources", async () => {
    const result = await createBookingEngine({ repository, authorizer }).availability(identity, tenant, { serviceId: "svc", staffId: "staff", dateIso: availabilityDate });
    expect(result.status).toBe("ok");
    expect(result.slots.length).toBeGreaterThan(0);
  });

  it("requires current server-side availability before creating", async () => {
    repository.createAppointment.mockClear();
    const startAt = localWallTimeToUtc(availabilityDate, 9 * 60, "Europe/Istanbul");
    const result = await createBookingEngine({ repository, authorizer }).create(identity, tenant, {
      serviceId: "svc", staffId: "staff", customerProfileId: "p", startAt,
    });
    expect(result.status).toBe("created");
    expect(repository.createAppointment).toHaveBeenCalledOnce();
  });

  it("rejects a past slot before asking persistence to create an appointment", async () => {
    repository.createAppointment.mockClear();
    const previousMonday = new Date(`${availabilityDate}T00:00:00.000Z`);
    previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
    const pastDateIso = previousMonday.toISOString().slice(0, 10);
    const startAt = localWallTimeToUtc(pastDateIso, 9 * 60, "Europe/Istanbul");
    const result = await createBookingEngine({ repository, authorizer }).create(identity, tenant, {
      serviceId: "svc", staffId: "staff", customerProfileId: "p", startAt,
    });
    expect(result.status).toBe("SLOT_UNAVAILABLE");
    expect(repository.createAppointment).not.toHaveBeenCalled();
  });

  it("uses staff decision authorization for confirm/reject", async () => {
    const appointment = { id: "a", tenantId: "t", staffId: "staff", serviceId: "svc", customerProfileId: "p",
      startAt: new Date("2026-10-05T06:00:00.000Z"), endAt: new Date("2026-10-05T07:15:00.000Z"), status: "PENDING" as const };
    await createBookingEngine({ repository, authorizer }).transition(identity, tenant, appointment, "CONFIRMED");
    expect(authorizer.authorizeStaffDecision).toHaveBeenCalled();
  });
});
