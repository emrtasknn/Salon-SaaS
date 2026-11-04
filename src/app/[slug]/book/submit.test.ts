import { beforeEach, describe, expect, it, vi } from "vitest";

const { vitrinLoad, bookingCreate, publishAppointmentNotification, prisma } = vi.hoisted(() => ({
  vitrinLoad: vi.fn(),
  bookingCreate: vi.fn(),
  publishAppointmentNotification: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("../../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../../persistence/prisma-public-vitrin", () => ({ createPrismaPublicSalonRepository: vi.fn(() => ({})) }));
vi.mock("../../../application/public-vitrin", () => ({ createPublicVitrin: vi.fn(() => ({ load: vitrinLoad })) }));
vi.mock("../../../persistence/prisma-public-booking", () => ({ createPrismaPublicBookingRepository: vi.fn(() => ({})) }));
vi.mock("../../../application/public-booking", () => ({ createPublicBooking: vi.fn(() => ({ create: bookingCreate })) }));
vi.mock("../../notification-runtime", () => ({ publishAppointmentNotification }));
vi.mock("../../../application/public-availability", () => ({ createPublicAvailability: vi.fn(() => ({ list: vi.fn() })) }));
vi.mock("../../../persistence/prisma-public-availability", () => ({ createPrismaPublicAvailabilityRepository: vi.fn(() => ({})) }));

import { submitBooking } from "./submit";

const vitrinTenantContext = { tenantId: "tenant-from-slug" };

const input = {
  slug: "salon-a",
  serviceId: "service-1",
  staffId: "staff-1",
  startAtIso: "2026-11-05T10:00:00.000Z",
  displayName: "Ayşe",
  email: "ayse@example.test",
  phone: "+905550000000",
};

beforeEach(() => {
  vitrinLoad.mockReset();
  bookingCreate.mockReset();
  publishAppointmentNotification.mockReset();
});

describe("submitBooking", () => {
  it("publishes APPOINTMENT_CREATED once with the slug-resolved tenant context on created", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    bookingCreate.mockResolvedValue({ status: "created", appointmentId: "appt-1" });

    // Client-supplied extra tenant fields must not influence the tenant context.
    const result = await submitBooking({ ...input, tenantId: "tenant-from-client" } as typeof input);

    expect(result).toEqual({ status: "created", appointmentId: "appt-1" });
    expect(vitrinLoad).toHaveBeenCalledWith("salon-a");
    expect(bookingCreate).toHaveBeenCalledTimes(1);
    expect(bookingCreate.mock.calls[0][0]).toBe(vitrinTenantContext);
    expect(bookingCreate.mock.calls[0][1]).toEqual({
      serviceId: "service-1",
      staffId: "staff-1",
      startAt: new Date("2026-11-05T10:00:00.000Z"),
      displayName: "Ayşe",
      email: "ayse@example.test",
      phone: "+905550000000",
    });
    expect(publishAppointmentNotification).toHaveBeenCalledTimes(1);
    expect(publishAppointmentNotification).toHaveBeenCalledWith(vitrinTenantContext, "appt-1", "APPOINTMENT_CREATED");
    expect(publishAppointmentNotification.mock.calls[0][0]).toBe(vitrinTenantContext);
  });

  it("returns NOT_FOUND for an unknown slug without creating a booking or notifying", async () => {
    vitrinLoad.mockResolvedValue({ status: "NOT_FOUND" });

    const result = await submitBooking({ ...input, slug: "unknown" });

    expect(result).toEqual({ status: "NOT_FOUND" });
    expect(bookingCreate).not.toHaveBeenCalled();
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });

  it.each([
    { status: "SLOT_UNAVAILABLE" },
    { status: "INVALID_RESOURCE" },
    { status: "INVALID_INPUT" },
    { status: "PERSISTENCE_FAILURE" },
  ])("passes through $status without notifying", async (bookingResult) => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    bookingCreate.mockResolvedValue(bookingResult);

    const result = await submitBooking(input);

    expect(result).toEqual(bookingResult);
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });
});

describe("public booking actions module", () => {
  it("exports only getPublicAvailability (no second booking action)", async () => {
    const actions = await import("./actions");
    expect(Object.keys(actions).sort()).toEqual(["getPublicAvailability"]);
  });
});
