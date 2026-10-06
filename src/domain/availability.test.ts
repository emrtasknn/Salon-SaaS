import { describe, expect, it } from "vitest";
import { calculateAvailability, localWallTimeToUtc } from "./availability";

const hours = [{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 9 * 60, closeMinute: 18 * 60 }];
const base = {
  dateIso: "2026-10-05",
  timeZone: "Europe/Istanbul",
  workingHours: hours,
  staffId: "s",
  durationMinutes: 60,
  bufferMinutes: 15,
  appointments: [],
};

describe("availability", () => {
  it("respects working hours and buffer", () => {
    const slots = calculateAvailability(base);
    expect(slots[0].startAt.toISOString()).toBe("2026-10-05T06:00:00.000Z");
    expect(slots.at(-1)?.startAt.toISOString()).toBe("2026-10-05T14:45:00.000Z");
  });

  it("excludes conflicting non-cancelled appointments", () => {
    const start = localWallTimeToUtc("2026-10-05", 10 * 60, "Europe/Istanbul");
    const slots = calculateAvailability({
      ...base,
      appointments: [{ id: "a", tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "c", startAt: start, endAt: new Date(start.getTime() + 75 * 60_000), status: "CONFIRMED" }],
    });
    expect(slots.some((s) => s.startAt.getTime() === start.getTime())).toBe(false);
  });

  it("returns no slots on a closed day", () => {
    expect(calculateAvailability({ ...base, dateIso: "2026-10-04" })).toEqual([]);
  });
});
