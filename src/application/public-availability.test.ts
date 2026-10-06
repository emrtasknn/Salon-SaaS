import { describe, expect, it, vi } from "vitest";
import { createPublicAvailability } from "./public-availability";

const workingHours = [{
  id: "wh",
  tenantId: "t",
  dayOfWeek: 1,
  openMinute: 9 * 60,
  closeMinute: 11 * 60,
}];

describe("public availability", () => {
  it("returns server-calculated slots for an active service and staff", async () => {
    const repository = {
      read: vi.fn().mockResolvedValue({
        status: "ok",
        timeZone: "Europe/Istanbul",
        durationMinutes: 30,
        bufferMinutes: 0,
        workingHours,
        appointments: [],
        serviceActive: true,
        staffActive: true,
      }),
    };

    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "svc",
      staffId: "staff",
      dateIso: "2026-10-12",
    });

    expect(result.status).toBe("ok");
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0]?.startAtIso).toBe("2026-10-12T06:00:00.000Z");
  });

  it("rejects malformed input before persistence", async () => {
    const repository = { read: vi.fn() };
    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "",
      staffId: "staff",
      dateIso: "2026-10-12",
    });

    expect(result).toEqual({ status: "INVALID_INPUT", slots: [] });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it("fails closed when persistence fails", async () => {
    const repository = { read: vi.fn().mockRejectedValue(new Error("db")) };
    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "svc",
      staffId: "staff",
      dateIso: "2026-10-12",
    });

    expect(result).toEqual({ status: "PERSISTENCE_FAILURE", slots: [] });
  });

  it("does not expose inactive resources as available", async () => {
    const repository = {
      read: vi.fn().mockResolvedValue({
        status: "ok",
        timeZone: "Europe/Istanbul",
        durationMinutes: 30,
        bufferMinutes: 0,
        workingHours,
        appointments: [],
        serviceActive: false,
        staffActive: true,
      }),
    };

    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "svc",
      staffId: "staff",
      dateIso: "2026-10-12",
    });

    expect(result).toEqual({ status: "INVALID_RESOURCE", slots: [] });
  });
});
