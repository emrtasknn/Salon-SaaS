import { describe, expect, it, vi } from "vitest";
import { createPublicAvailability } from "./public-availability";

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

const availabilityDate = nextMondayIso();
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
      dateIso: availabilityDate,
    });

    expect(result.status).toBe("ok");
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0]?.startAtIso).toBe(`${availabilityDate}T06:00:00.000Z`);
  });

  it("rejects malformed input before persistence", async () => {
    const repository = { read: vi.fn() };
    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "",
      staffId: "staff",
      dateIso: availabilityDate,
    });

    expect(result).toEqual({ status: "INVALID_INPUT", slots: [] });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it("fails closed when persistence fails", async () => {
    const repository = { read: vi.fn().mockRejectedValue(new Error("db")) };
    const result = await createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "svc",
      staffId: "staff",
      dateIso: availabilityDate,
    });

    expect(result).toEqual({ status: "PERSISTENCE_FAILURE", slots: [] });
  });

  it("fails closed when the tenant timezone is invalid", async () => {
    const repository = {
      read: vi.fn().mockResolvedValue({
        status: "ok",
        timeZone: "Invalid/Timezone",
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
      dateIso: availabilityDate,
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
      dateIso: availabilityDate,
    });

    expect(result).toEqual({ status: "INVALID_RESOURCE", slots: [] });
  });

  it("returns TENANT_INACTIVE with no slots, distinct from INVALID_RESOURCE (WP-07)", async () => {
    const repository = { read: vi.fn().mockResolvedValue({ status: "tenant_inactive" }) };
    await expect(createPublicAvailability(repository).list({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", dateIso: availabilityDate,
    })).resolves.toEqual({ status: "TENANT_INACTIVE", slots: [] });
  });
});

describe("public availability closed dates (WP-08)", () => {
  const okRead = (closedDates: string[]) => ({
    read: vi.fn().mockResolvedValue({
      status: "ok", timeZone: "Europe/Istanbul", durationMinutes: 30, bufferMinutes: 0,
      workingHours, appointments: [], closedDates, serviceActive: true, staffActive: true,
    }),
  });

  it("offers no slots on a closed date", async () => {
    const result = await createPublicAvailability(okRead([availabilityDate])).list({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", dateIso: availabilityDate,
    });
    expect(result).toEqual({ status: "ok", timeZone: "Europe/Istanbul", slots: [] });
  });

  it("ignores closures on other dates", async () => {
    const result = await createPublicAvailability(okRead(["2000-01-01"])).list({ tenantId: "t" as never }, {
      serviceId: "svc", staffId: "staff", dateIso: availabilityDate,
    });
    expect(result.slots.length).toBeGreaterThan(0);
  });
});
