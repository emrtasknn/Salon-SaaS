import { describe, expect, it } from "vitest";
import { addDaysToDateIso, calculateAvailability, isSlotOnClosedDate, localDayUtcRange, localWallTimeToUtc } from "./availability";

// WP-08: closed local dates in availability + DST/timezone boundaries.

const monday = "2026-11-09";
const tuesday = "2026-11-10";
const hours = [1, 2].map((dayOfWeek) => ({ id: `wh${dayOfWeek}`, tenantId: "t", dayOfWeek, openMinute: 9 * 60, closeMinute: 18 * 60 }));
const base = {
  dateIso: monday, timeZone: "Europe/Istanbul", workingHours: hours, staffId: "s", appointments: [],
  durationMinutes: 60, bufferMinutes: 15, now: new Date("2026-01-01T00:00:00.000Z"),
};

describe("calculateAvailability with closed dates", () => {
  it("returns no slots on a closed date", () => {
    expect(calculateAvailability({ ...base, closedDates: [monday] })).toEqual([]);
    expect(calculateAvailability({ ...base, closedDates: new Set([monday]) })).toEqual([]);
  });

  it("is unchanged when other dates are closed or the input is omitted", () => {
    const open = calculateAvailability(base);
    expect(open.length).toBeGreaterThan(0);
    expect(calculateAvailability({ ...base, closedDates: [tuesday, "2026-11-08"] })).toEqual(open);
    expect(calculateAvailability({ ...base, closedDates: [] })).toEqual(open);
  });

  it("keeps the conflict rule unchanged next to closures", () => {
    const appointments = [{
      id: "a", tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "c", status: "CONFIRMED" as const,
      startAt: localWallTimeToUtc(monday, 9 * 60, "Europe/Istanbul"), endAt: localWallTimeToUtc(monday, 10 * 60 + 15, "Europe/Istanbul"),
    }];
    const slots = calculateAvailability({ ...base, appointments, closedDates: [tuesday] });
    expect(slots[0].startAt).toEqual(localWallTimeToUtc(monday, 10 * 60 + 15, "Europe/Istanbul"));
  });
});

describe("isSlotOnClosedDate", () => {
  const tz = "Europe/Istanbul";
  const lateStart = localWallTimeToUtc(monday, 23 * 60, tz);

  it("rejects when the local start date is closed", () => {
    expect(isSlotOnClosedDate({ startAt: lateStart, endAt: new Date(lateStart.getTime() + 30 * 60_000) }, tz, [monday])).toBe(true);
  });

  it("rejects when the end incl. buffer crosses into a closed local date (owner-approved)", () => {
    const endAt = new Date(lateStart.getTime() + 90 * 60_000); // 00:30 on Tuesday
    expect(isSlotOnClosedDate({ startAt: lateStart, endAt }, tz, [tuesday])).toBe(true);
  });

  it("does not reject a slot ending exactly at local midnight before a closed date", () => {
    const endAt = localWallTimeToUtc(tuesday, 0, tz);
    expect(isSlotOnClosedDate({ startAt: lateStart, endAt }, tz, [tuesday])).toBe(false);
  });

  it("uses the tenant timezone, not UTC, for the local date", () => {
    // 2026-11-09 22:30 UTC is already Tuesday 01:30 in Istanbul (UTC+3).
    const startAt = new Date("2026-11-09T22:30:00.000Z");
    const slot = { startAt, endAt: new Date(startAt.getTime() + 30 * 60_000) };
    expect(isSlotOnClosedDate(slot, tz, [tuesday])).toBe(true);
    expect(isSlotOnClosedDate(slot, tz, [monday])).toBe(false);
    expect(isSlotOnClosedDate(slot, "UTC", [monday])).toBe(true);
  });

  it("is false with no closures", () => {
    expect(isSlotOnClosedDate({ startAt: lateStart, endAt: lateStart }, tz, [])).toBe(false);
  });
});

describe("localDayUtcRange (DST-safe)", () => {
  it("Istanbul (no DST): a 24-hour day at UTC+3", () => {
    expect(localDayUtcRange(monday, "Europe/Istanbul")).toEqual({
      startAt: new Date("2026-11-08T21:00:00.000Z"), endAt: new Date("2026-11-09T21:00:00.000Z"),
    });
  });

  it("Berlin spring forward (last Sunday of March): a 23-hour day", () => {
    const range = localDayUtcRange("2026-03-29", "Europe/Berlin");
    expect(range).toEqual({ startAt: new Date("2026-03-28T23:00:00.000Z"), endAt: new Date("2026-03-29T22:00:00.000Z") });
    expect(range.endAt.getTime() - range.startAt.getTime()).toBe(23 * 3_600_000);
  });

  it("Berlin fall back (last Sunday of October): a 25-hour day", () => {
    const range = localDayUtcRange("2026-10-25", "Europe/Berlin");
    expect(range).toEqual({ startAt: new Date("2026-10-24T22:00:00.000Z"), endAt: new Date("2026-10-25T23:00:00.000Z") });
    expect(range.endAt.getTime() - range.startAt.getTime()).toBe(25 * 3_600_000);
  });

  it("Santiago midnight gap: does not throw; the day starts at the first existing minute (01:00)", () => {
    expect(() => localWallTimeToUtc("2026-09-06", 0, "America/Santiago")).toThrow(RangeError);
    expect(localDayUtcRange("2026-09-06", "America/Santiago")).toEqual({
      startAt: new Date("2026-09-06T04:00:00.000Z"), endAt: new Date("2026-09-07T03:00:00.000Z"),
    });
    // The previous day ends where the gap day begins (contiguous ranges).
    expect(localDayUtcRange("2026-09-05", "America/Santiago").endAt).toEqual(new Date("2026-09-06T04:00:00.000Z"));
  });

  it("closure boundary on a DST day: last instant of the 25-hour day is still that date", () => {
    const range = localDayUtcRange("2026-10-25", "Europe/Berlin");
    const slot = { startAt: new Date(range.endAt.getTime() - 30 * 60_000), endAt: range.endAt };
    expect(isSlotOnClosedDate(slot, "Europe/Berlin", ["2026-10-25"])).toBe(true);
    expect(isSlotOnClosedDate(slot, "Europe/Berlin", ["2026-10-26"])).toBe(false);
  });

  it("rejects invalid dates and timezones", () => {
    expect(() => localDayUtcRange("2026-02-30", "Europe/Istanbul")).toThrow(TypeError);
    expect(() => localDayUtcRange(monday, "Not/AZone")).toThrow(TypeError);
  });
});

describe("addDaysToDateIso", () => {
  it("handles month/year/leap boundaries", () => {
    expect(addDaysToDateIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDateIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});

// QA (WP-08): additional timezone/DST boundary cases for closed dates.
describe("closed dates across DST and UTC-day boundaries (QA)", () => {
  const allDay = (dayOfWeek: number, openMinute = 0, closeMinute = 1440) => ({ id: `wh${dayOfWeek}`, tenantId: "t", dayOfWeek, openMinute, closeMinute });
  const past = new Date("2026-01-01T00:00:00.000Z");
  const berlin = { timeZone: "Europe/Berlin", staffId: "s", appointments: [], durationMinutes: 45, bufferMinutes: 15, now: past };
  const berlinHours = [0, 1, 6].map((d) => allDay(d, 0, 1440));

  it("Berlin spring forward (2026-03-29): closed day has no slots; the Saturday before and Monday after are unaffected", () => {
    const closed = ["2026-03-29"];
    expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: "2026-03-29" }).length).toBeGreaterThan(0);
    expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: "2026-03-29", closedDates: closed })).toEqual([]);
    for (const open of ["2026-03-28", "2026-03-30"]) {
      const unclosed = calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: open });
      expect(unclosed.length).toBeGreaterThan(0);
      expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: open, closedDates: closed })).toEqual(unclosed);
    }
  });

  it("Berlin spring forward: the last Saturday slot ending exactly at local midnight survives a closed Sunday", () => {
    const slots = calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: "2026-03-28", closedDates: ["2026-03-29"] });
    const last = slots[slots.length - 1];
    expect(last.startAt).toEqual(new Date("2026-03-28T22:00:00.000Z")); // 23:00 CET
    expect(last.endAt).toEqual(localDayUtcRange("2026-03-29", "Europe/Berlin").startAt);
  });

  it("Berlin fall back (2026-10-25): closed day has no slots; Saturday and Monday are unaffected", () => {
    const closed = ["2026-10-25"];
    expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: "2026-10-25" }).length).toBeGreaterThan(0);
    expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: "2026-10-25", closedDates: closed })).toEqual([]);
    for (const open of ["2026-10-24", "2026-10-26"]) {
      const unclosed = calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: open });
      expect(calculateAvailability({ ...berlin, workingHours: berlinHours, dateIso: open, closedDates: closed })).toEqual(unclosed);
    }
  });

  it("Berlin fall back: both 02:30 instants of the repeated hour belong to the closed date", () => {
    const first = new Date("2026-10-25T00:30:00.000Z"); // 02:30 CEST
    const second = new Date("2026-10-25T01:30:00.000Z"); // 02:30 CET
    for (const startAt of [first, second]) {
      const slot = { startAt, endAt: new Date(startAt.getTime() + 30 * 60_000) };
      expect(isSlotOnClosedDate(slot, "Europe/Berlin", ["2026-10-25"])).toBe(true);
      expect(isSlotOnClosedDate(slot, "Europe/Berlin", ["2026-10-24", "2026-10-26"])).toBe(false);
    }
  });

  it("Istanbul early local slot whose UTC instant is the previous UTC day follows the local date", () => {
    // Tuesday 2026-11-10 01:00 Istanbul = Monday 2026-11-09 22:00 UTC.
    const hoursTue = [allDay(2, 60, 300)];
    const input = { dateIso: tuesday, timeZone: "Europe/Istanbul", workingHours: hoursTue, staffId: "s", appointments: [], durationMinutes: 45, bufferMinutes: 15, now: past };
    const open = calculateAvailability(input);
    expect(open[0].startAt).toEqual(new Date("2026-11-09T22:00:00.000Z"));
    expect(calculateAvailability({ ...input, closedDates: [tuesday] })).toEqual([]);
    expect(calculateAvailability({ ...input, closedDates: [monday] })).toEqual(open);
  });

  it("Los Angeles late local slot whose UTC instant is the next UTC day follows the local date", () => {
    // Monday 2026-11-09 22:00 PST = Tuesday 2026-11-10 06:00 UTC.
    const input = { dateIso: monday, timeZone: "America/Los_Angeles", workingHours: [allDay(1, 21 * 60, 1440)], staffId: "s", appointments: [], durationMinutes: 45, bufferMinutes: 15, now: past };
    const open = calculateAvailability(input);
    expect(open.map((s) => s.startAt.toISOString())).toContain("2026-11-10T06:00:00.000Z");
    expect(calculateAvailability({ ...input, closedDates: [tuesday] })).toEqual(open);
    expect(calculateAvailability({ ...input, closedDates: [monday] })).toEqual([]);
  });

  it("a buffer crossing local midnight into a closed date is rejected; the same slot is fine when only the start day is open", () => {
    // Berlin Saturday 23:30 CET + 45 min + 15 min buffer -> 00:30 on the closed Sunday.
    const startAt = new Date("2026-03-28T22:30:00.000Z");
    const endAt = new Date(startAt.getTime() + 60 * 60_000);
    expect(isSlotOnClosedDate({ startAt, endAt }, "Europe/Berlin", ["2026-03-29"])).toBe(true);
    expect(isSlotOnClosedDate({ startAt, endAt }, "Europe/Berlin", ["2026-03-30"])).toBe(false);
    // Only the buffer (last 15 min) crosses midnight: still rejected.
    const bufferOnly = { startAt: new Date("2026-03-28T22:15:00.000Z"), endAt: new Date("2026-03-28T23:15:00.000Z") };
    expect(isSlotOnClosedDate(bufferOnly, "Europe/Berlin", ["2026-03-29"])).toBe(true);
  });

  it("Havana spring forward at midnight (2026-03-08): localDayUtcRange does not throw and starts at 01:00", () => {
    expect(() => localWallTimeToUtc("2026-03-08", 0, "America/Havana")).toThrow(RangeError);
    const range = localDayUtcRange("2026-03-08", "America/Havana");
    expect(range).toEqual({ startAt: new Date("2026-03-08T05:00:00.000Z"), endAt: new Date("2026-03-09T04:00:00.000Z") });
    expect(range.endAt.getTime() - range.startAt.getTime()).toBe(23 * 3_600_000);
    expect(localDayUtcRange("2026-03-07", "America/Havana").endAt).toEqual(range.startAt);
  });

  it("Havana fall back at 01:00 -> 00:00 (2026-11-01): ambiguous midnight starts at the earlier instant; 25-hour day", () => {
    const range = localDayUtcRange("2026-11-01", "America/Havana");
    expect(range).toEqual({ startAt: new Date("2026-11-01T04:00:00.000Z"), endAt: new Date("2026-11-02T05:00:00.000Z") });
    expect(localDayUtcRange("2026-10-31", "America/Havana").endAt).toEqual(range.startAt);
  });

  it("Santiago midnight-gap day: calculateAvailability skips the missing hour and a closure still applies", () => {
    // 2026-09-06 is a Sunday; 00:00-00:59 does not exist.
    const input = { dateIso: "2026-09-06", timeZone: "America/Santiago", workingHours: [allDay(0, 0, 180)], staffId: "s", appointments: [], durationMinutes: 45, bufferMinutes: 15, now: past };
    const open = calculateAvailability(input);
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].startAt).toEqual(new Date("2026-09-06T04:00:00.000Z")); // 01:00 -03
    expect(calculateAvailability({ ...input, closedDates: ["2026-09-06"] })).toEqual([]);
    expect(calculateAvailability({ ...input, closedDates: ["2026-09-05"] })).toEqual(open);
  });
});
