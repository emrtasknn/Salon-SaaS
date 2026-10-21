import { describe, expect, it } from "vitest";
import { calculateAvailability, dateDayOfWeek, localWallTimeToUtc } from "./availability";

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
    expect(slots.at(-1)?.startAt.toISOString()).toBe("2026-10-05T13:45:00.000Z");
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

  it("rejects an invalid timezone even when the day is closed", () => {
    expect(() => calculateAvailability({
      ...base,
      dateIso: "2026-10-04",
      timeZone: "Invalid/Timezone",
    })).toThrow("Timezone is invalid");
  });

  describe("calendar date validation", () => {
    it("rejects non-existent dates such as 2026-02-31 and 2026-13-01 in dateDayOfWeek", () => {
      expect(() => dateDayOfWeek("2026-02-31")).toThrow(new TypeError("Date is invalid"));
      expect(() => dateDayOfWeek("2026-13-01")).toThrow(new TypeError("Date is invalid"));
    });

    it("accepts valid leap year date 2024-02-29 and 2026-02-28 in dateDayOfWeek", () => {
      expect(dateDayOfWeek("2024-02-29")).toBe(4);
      expect(dateDayOfWeek("2026-02-28")).toBe(6);
    });

    it("rejects non-existent dates in localWallTimeToUtc", () => {
      expect(() => localWallTimeToUtc("2026-02-31", 540, "Europe/Istanbul")).toThrow(new TypeError("Date is invalid"));
      expect(() => localWallTimeToUtc("2026-13-01", 540, "Europe/Istanbul")).toThrow(new TypeError("Date is invalid"));
    });

    it("accepts valid dates in localWallTimeToUtc", () => {
      expect(localWallTimeToUtc("2024-02-29", 540, "Europe/Istanbul")).toBeInstanceOf(Date);
      expect(localWallTimeToUtc("2026-02-28", 540, "Europe/Istanbul")).toBeInstanceOf(Date);
    });

    it("rejects invalid dates in calculateAvailability without silent normalization", () => {
      expect(() => calculateAvailability({ ...base, dateIso: "2026-02-31" })).toThrow(new TypeError("Date is invalid"));
      expect(() => calculateAvailability({ ...base, dateIso: "2026-13-01" })).toThrow(new TypeError("Date is invalid"));
      expect(() => calculateAvailability({ ...base, dateIso: "2024-02-29" })).not.toThrow();
      expect(() => calculateAvailability({ ...base, dateIso: "2026-02-28" })).not.toThrow();
    });
  });
});
