import { beforeEach, describe, expect, it, vi } from "vitest";

const { vitrinLoad, availabilityList, checkRateLimit, readClientIp, prisma } = vi.hoisted(() => ({
  vitrinLoad: vi.fn(),
  availabilityList: vi.fn(),
  checkRateLimit: vi.fn(),
  readClientIp: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("../../../infrastructure/prisma-runtime", () => ({ getPrisma: vi.fn(() => prisma) }));
vi.mock("../../../persistence/prisma-public-vitrin", () => ({ createPrismaPublicSalonRepository: vi.fn(() => ({})) }));
vi.mock("../../../application/public-vitrin", () => ({ createPublicVitrin: vi.fn(() => ({ load: vitrinLoad })) }));
vi.mock("../../../application/public-availability", () => ({
  createPublicAvailability: vi.fn(() => ({ list: availabilityList })),
}));
vi.mock("../../../persistence/prisma-public-availability", () => ({
  createPrismaPublicAvailabilityRepository: vi.fn(() => ({})),
}));
vi.mock("../../rate-limit-runtime", () => ({ checkRateLimit, readClientIp }));

import { getPublicAvailability } from "./actions";

const tenantContext = { tenantId: "tenant-from-slug" };
const input = { slug: "salon-a", serviceId: "service-1", staffId: "staff-1", dateIso: "2026-11-05" };

beforeEach(() => {
  vitrinLoad.mockReset();
  availabilityList.mockReset();
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ status: "ALLOWED" });
  readClientIp.mockReset();
  readClientIp.mockResolvedValue("198.51.100.9");
});

describe("getPublicAvailability rate limiting (WP-5)", () => {
  it("returns RATE_LIMITED with no slots before querying availability", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: true, tenantContext });
    checkRateLimit.mockResolvedValue({ status: "RATE_LIMITED", retryAfterSeconds: 30 });

    const result = await getPublicAvailability(input);

    expect(result).toEqual({ status: "RATE_LIMITED", retryAfterSeconds: 30, slots: [] });
    expect(availabilityList).not.toHaveBeenCalled();
  });

  it("checks the per-IP availability bucket only", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: true, tenantContext });
    availabilityList.mockResolvedValue({ status: "ok", slots: [] });

    await getPublicAvailability(input);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith([{ bucket: "booking.availability", subject: "198.51.100.9" }]);
  });

  it("keeps the ALLOWED path unchanged with the slug-resolved tenant context", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: true, tenantContext });
    const listed = { status: "ok", slots: [{ startAt: "2026-11-05T10:00:00.000Z" }] };
    availabilityList.mockResolvedValue(listed);

    const result = await getPublicAvailability({ ...input, tenantId: "tenant-from-client" } as typeof input);

    expect(result).toBe(listed);
    expect(availabilityList).toHaveBeenCalledTimes(1);
    expect(availabilityList.mock.calls[0][0]).toBe(tenantContext);
    expect(checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(availabilityList.mock.invocationCallOrder[0]);
  });

  it("returns TENANT_INACTIVE with no slots for an inactive salon (WP-07)", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: false, tenantContext });

    await expect(getPublicAvailability(input)).resolves.toEqual({ status: "TENANT_INACTIVE", slots: [] });
    expect(availabilityList).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an unknown slug without a limiter call or query", async () => {
    vitrinLoad.mockResolvedValue({ status: "NOT_FOUND" });

    await expect(getPublicAvailability({ ...input, slug: "unknown" })).resolves.toEqual({ status: "NOT_FOUND", slots: [] });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(availabilityList).not.toHaveBeenCalled();
  });
});

describe("getPublicAvailability with \"Fark etmez\"", () => {
  const staff = [{ id: "staff-a" }, { id: "staff-b" }];
  const slot = (hhmm: string) => ({ startAtIso: `2026-11-05T${hhmm}:00.000Z`, endAtIso: `2026-11-05T${hhmm}:30.000Z` });

  it("reads every catalog staff member once, charges the limiter once and merges their slots", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: true, tenantContext, staff });
    availabilityList
      .mockResolvedValueOnce({ status: "ok", timeZone: "Europe/Istanbul", slots: [slot("09:00"), slot("07:00")] })
      .mockResolvedValueOnce({ status: "ok", timeZone: "Europe/Istanbul", slots: [slot("07:00"), slot("08:00")] });

    const result = await getPublicAvailability({ ...input, staffId: "any" });

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(availabilityList.mock.calls.map((call) => call[1].staffId)).toEqual(["staff-a", "staff-b"]);
    expect(availabilityList.mock.calls.every((call) => call[0] === tenantContext)).toBe(true);
    expect(result).toEqual({ status: "ok", timeZone: "Europe/Istanbul", slots: [slot("07:00"), slot("08:00"), slot("09:00")] });
  });

  it("reports the first error when no staff member can be read", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", active: true, tenantContext, staff });
    availabilityList.mockResolvedValue({ status: "INVALID_RESOURCE", slots: [] });

    await expect(getPublicAvailability({ ...input, staffId: "any" })).resolves.toEqual({ status: "INVALID_RESOURCE", slots: [] });
  });
});

describe("getPublicAvailability \"Fark etmez\" with staff–service mapping", () => {
  it("only reads staff who perform the service (no mapping = every service)", async () => {
    vitrinLoad.mockResolvedValue({
      status: "ok", active: true, tenantContext,
      staff: [{ id: "staff-a", serviceIds: ["service-other"] }, { id: "staff-b", serviceIds: [] }, { id: "staff-c", serviceIds: ["service-1"] }],
    });
    availabilityList.mockResolvedValue({ status: "ok", timeZone: "Europe/Istanbul", slots: [] });

    await getPublicAvailability({ ...input, staffId: "any" });

    expect(availabilityList.mock.calls.map((call) => call[1].staffId)).toEqual(["staff-b", "staff-c"]);
  });
});
