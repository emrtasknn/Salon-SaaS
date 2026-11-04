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
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext });
    checkRateLimit.mockResolvedValue({ status: "RATE_LIMITED", retryAfterSeconds: 30 });

    const result = await getPublicAvailability(input);

    expect(result).toEqual({ status: "RATE_LIMITED", retryAfterSeconds: 30, slots: [] });
    expect(availabilityList).not.toHaveBeenCalled();
  });

  it("checks the per-IP availability bucket only", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext });
    availabilityList.mockResolvedValue({ status: "ok", slots: [] });

    await getPublicAvailability(input);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith([{ bucket: "booking.availability", subject: "198.51.100.9" }]);
  });

  it("keeps the ALLOWED path unchanged with the slug-resolved tenant context", async () => {
    vitrinLoad.mockResolvedValue({ status: "ok", tenantContext });
    const listed = { status: "ok", slots: [{ startAt: "2026-11-05T10:00:00.000Z" }] };
    availabilityList.mockResolvedValue(listed);

    const result = await getPublicAvailability({ ...input, tenantId: "tenant-from-client" } as typeof input);

    expect(result).toBe(listed);
    expect(availabilityList).toHaveBeenCalledTimes(1);
    expect(availabilityList.mock.calls[0][0]).toBe(tenantContext);
    expect(checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(availabilityList.mock.invocationCallOrder[0]);
  });

  it("returns NOT_FOUND for an unknown slug without a limiter call or query", async () => {
    vitrinLoad.mockResolvedValue({ status: "NOT_FOUND" });

    await expect(getPublicAvailability({ ...input, slug: "unknown" })).resolves.toEqual({ status: "NOT_FOUND", slots: [] });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(availabilityList).not.toHaveBeenCalled();
  });
});
