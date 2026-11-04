import { describe, expect, it, vi } from "vitest";
import { hashAppointmentAccessToken } from "../domain/appointment-access-token";
import { createPublicBooking } from "./public-booking";

const tenant = { tenantId: "tenant-a" as never };
const validInput = {
  serviceId: "svc-a", staffId: "staff-a", startAt: new Date("2026-10-05T06:00:00Z"),
  displayName: " Customer ", email: "c@example.com", phone: "+90555",
};

describe("public booking", () => {
  it("validates customer input before persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    const result = await createPublicBooking(repository).create(tenant, validInput);
    expect(result).toEqual({ status: "created", appointmentId: "appointment-a", accessToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(repository.create).toHaveBeenCalled();
  });

  it("passes only the access-token hash to persistence and returns the raw token once", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    const result = await createPublicBooking(repository).create(tenant, validInput);
    if (result.status !== "created") throw new Error("expected created");
    const persisted = repository.create.mock.calls[0][1];
    expect(persisted.accessTokenHash).toBe(hashAppointmentAccessToken(result.accessToken));
    expect(persisted.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(repository.create.mock.calls)).not.toContain(result.accessToken);
  });

  it("does not return a token when the booking is not created", async () => {
    const repository = { create: vi.fn().mockResolvedValue("slot_unavailable") };
    await expect(createPublicBooking(repository).create(tenant, validInput)).resolves.toEqual({ status: "SLOT_UNAVAILABLE" });
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
