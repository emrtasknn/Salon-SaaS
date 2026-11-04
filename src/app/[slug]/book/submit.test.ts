import { beforeEach, describe, expect, it, vi } from "vitest";

const { vitrinLoad, bookingCreate, publishAppointmentNotification, prisma, checkRateLimit, readClientIp } = vi.hoisted(() => ({
  vitrinLoad: vi.fn(),
  bookingCreate: vi.fn(),
  publishAppointmentNotification: vi.fn(),
  prisma: { marker: "prisma" },
  checkRateLimit: vi.fn(),
  readClientIp: vi.fn(),
}));

vi.mock("../../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../../persistence/prisma-public-vitrin", () => ({ createPrismaPublicSalonRepository: vi.fn(() => ({})) }));
vi.mock("../../../application/public-vitrin", () => ({ createPublicVitrin: vi.fn(() => ({ load: vitrinLoad })) }));
vi.mock("../../../persistence/prisma-public-booking", () => ({ createPrismaPublicBookingRepository: vi.fn(() => ({})) }));
vi.mock("../../../application/public-booking", () => ({ createPublicBooking: vi.fn(() => ({ create: bookingCreate })) }));
vi.mock("../../notification-runtime", () => ({ publishAppointmentNotification }));
vi.mock("../../rate-limit-runtime", () => ({ checkRateLimit, readClientIp }));
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
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ status: "ALLOWED" });
  readClientIp.mockReset();
  readClientIp.mockResolvedValue(null);
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

describe("submitBooking rate limiting (WP-5)", () => {
  it("returns RATE_LIMITED before booking creation or notification", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    checkRateLimit.mockResolvedValue({ status: "RATE_LIMITED", retryAfterSeconds: 120 });

    const result = await submitBooking(input);

    expect(result).toEqual({ status: "RATE_LIMITED", retryAfterSeconds: 120 });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(bookingCreate).not.toHaveBeenCalled();
    expect(publishAppointmentNotification).not.toHaveBeenCalled();
  });

  it("checks tenant+IP, global IP and tenant+phone buckets with the slug-resolved tenant, not client input", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    readClientIp.mockResolvedValue("203.0.113.7");
    bookingCreate.mockResolvedValue({ status: "created", appointmentId: "appt-1" });

    await submitBooking({ ...input, phone: "+90 (555) 000-00-00", tenantId: "tenant-from-client" } as typeof input);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit.mock.calls[0][0]).toEqual([
      { bucket: "booking.submit", tenantId: "tenant-from-slug", subject: "203.0.113.7" },
      { bucket: "booking.submit.global", subject: "203.0.113.7" },
      { bucket: "booking.submit.phone", tenantId: "tenant-from-slug", subject: "905550000000" },
    ]);
    expect(JSON.stringify(checkRateLimit.mock.calls)).not.toContain("tenant-from-client");
  });

  it("passes a null IP subject through (limiter skips IP buckets) and still checks the phone", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    bookingCreate.mockResolvedValue({ status: "created", appointmentId: "appt-1" });

    await submitBooking(input);

    const checks = checkRateLimit.mock.calls[0][0] as Array<{ bucket: string; subject: string | null }>;
    expect(checks.map((check) => [check.bucket, check.subject])).toEqual([
      ["booking.submit", null],
      ["booking.submit.global", null],
      ["booking.submit.phone", "905550000000"],
    ]);
  });

  it("does not rate-limit-check an unknown slug", async () => {
    vitrinLoad.mockResolvedValue({ status: "NOT_FOUND" });

    await expect(submitBooking({ ...input, slug: "unknown" })).resolves.toEqual({ status: "NOT_FOUND" });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("keeps the ALLOWED path unchanged (create + notify once)", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext: vitrinTenantContext });
    bookingCreate.mockResolvedValue({ status: "created", appointmentId: "appt-2" });

    const result = await submitBooking(input);

    expect(result).toEqual({ status: "created", appointmentId: "appt-2" });
    expect(checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(bookingCreate.mock.invocationCallOrder[0]);
    expect(publishAppointmentNotification).toHaveBeenCalledWith(vitrinTenantContext, "appt-2", "APPOINTMENT_CREATED");
  });
});

describe("public booking actions module", () => {
  it("exports only getPublicAvailability (no second booking action)", async () => {
    const actions = await import("./actions");
    expect(Object.keys(actions).sort()).toEqual(["getPublicAvailability"]);
  });
});
