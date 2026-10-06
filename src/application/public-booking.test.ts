import { describe, expect, it, vi } from "vitest";
import { createPublicBooking } from "./public-booking";

describe("public booking", () => {
  it("validates customer input before persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue("created") };
    const result = await createPublicBooking(repository).create({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", startAt: new Date(), displayName: " Customer ", email: "c@example.com", phone: "+90555",
    });
    expect(result).toEqual({ status: "created" });
    expect(repository.create).toHaveBeenCalled();
  });

  it("rejects malformed customer input", async () => {
    const repository = { create: vi.fn() };
    await expect(createPublicBooking(repository).create({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", startAt: "bad", displayName: "", email: "x",
    })).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
