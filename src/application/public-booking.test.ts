import { describe, expect, it, vi } from "vitest";
import { createPublicBooking } from "./public-booking";

const tenant = { tenantId: "tenant-a" as never };
const validInput = {
  serviceId: "svc-a", staffId: "staff-a", startAt: new Date("2026-10-05T06:00:00Z"),
  displayName: " Customer ", email: "c@example.com", phone: "+90555",
};

describe("public booking", () => {
  it("validates customer input before persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue("created") };
    const result = await createPublicBooking(repository).create(tenant, validInput);
    expect(result).toEqual({ status: "created" });
    expect(repository.create).toHaveBeenCalled();
  });

  it("rejects malformed customer input", async () => {
    const repository = { create: vi.fn() };
    await expect(createPublicBooking(repository).create(tenant, {
      ...validInput, startAt: "bad", displayName: "", email: "x",
    })).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("surfaces tenant-scoped resource rejection without retrying persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue("invalid_resource") };
    await expect(createPublicBooking(repository).create(tenant, validInput))
      .resolves.toEqual({ status: "INVALID_RESOURCE" });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
});
