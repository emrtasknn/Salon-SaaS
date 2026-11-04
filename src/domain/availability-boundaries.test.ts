import { describe, expect, it } from "vitest";
import {
  calculateAvailability,
  isSlotOnClosedDate,
  localDayUtcRange,
  localWallTimeToUtc,
  utcToLocalDateAndMinute,
} from "./availability";

// WP-11 (QA hardening): timezone/DST, duration + buffer at closing time and closure
// midnight boundaries. Pure domain tests; no database.

const past = new Date("2026-01-01T00:00:00.000Z");
const hoursFor = (dayOfWeek: number, openMinute: number, closeMinute: number) =>
  [{ id: `wh${dayOfWeek}`, tenantId: "t", dayOfWeek, openMinute, closeMinute }];
const startsOf = (slots: ReadonlyArray<{ startAt: Date }>) => slots.map((s) => s.startAt.toISOString());

describe("Europe/Istanbul has no DST (fixed UTC+3)", () => {
  it("maps 09:00 local to 06:00Z in winter and summer alike", () => {
    for (const dateIso of ["2026-01-12", "2026-03-29", "2026-07-13", "2026-10-25", "2026-12-28"]) {
      expect(localWallTimeToUtc(dateIso, 9 * 60, "Europe/Istanbul").toISOString()).toBe(`${dateIso}T06:00:00.000Z`);
    }
  });

  it("EU DST transition Sundays are ordinary 24-hour days with the full slot grid", () => {
    const input = (dateIso: string) => ({
      dateIso, timeZone: "Europe/Istanbul", workingHours: hoursFor(0, 0, 1440), staffId: "s", appointments: [],
      durationMinutes: 30, bufferMinutes: 0, slotIntervalMinutes: 30, now: past,
    });
    for (const dateIso of ["2026-03-29", "2026-10-25"]) {
      const range = localDayUtcRange(dateIso, "Europe/Istanbul");
      expect(range.endAt.getTime() - range.startAt.getTime()).toBe(24 * 3_600_000);
      expect(calculateAvailability(input(dateIso))).toHaveLength(48);
    }
  });
});

describe("DST tenant timezones (not provisionable in the MVP; see MVP_SUPPORTED_TIMEZONES)", () => {
  // Known gap (owner decision 2026-11-04: lock MVP to Europe/Istanbul, fix post-MVP):
  // availability checks closing time in wall-clock minutes but endAt in elapsed time,
  // so on a spring-forward day a slot can end up to 60 min after closing.
  it.todo("spring-forward day: no slot ends after the wall-clock closing time (post-MVP fix)");

  it("Berlin spring forward (2026-03-29): the non-existent 02:00-02:59 hour offers no slots", () => {
    const slots = calculateAvailability({
      dateIso: "2026-03-29", timeZone: "Europe/Berlin", workingHours: hoursFor(0, 60, 240), staffId: "s", appointments: [],
      durationMinutes: 15, bufferMinutes: 0, slotIntervalMinutes: 30, now: past,
    });
    // 01:00 and 01:30 CET, then 03:00 and 03:30 CEST.
    expect(startsOf(slots)).toEqual([
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T00:30:00.000Z",
      "2026-03-29T01:00:00.000Z",
      "2026-03-29T01:30:00.000Z",
    ]);
  });

  it("America/New_York spring forward (2026-03-08): skips 02:xx and keeps UTC-4 afterwards", () => {
    const slots = calculateAvailability({
      dateIso: "2026-03-08", timeZone: "America/New_York", workingHours: hoursFor(0, 60, 240), staffId: "s", appointments: [],
      durationMinutes: 15, bufferMinutes: 0, slotIntervalMinutes: 60, now: past,
    });
    // 01:00 EST (-5), then 03:00 EDT (-4); 02:00 does not exist.
    expect(startsOf(slots)).toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]);
  });

  it("America/New_York fall back (2026-11-01): the repeated 01:xx hour is skipped as ambiguous", () => {
    const slots = calculateAvailability({
      dateIso: "2026-11-01", timeZone: "America/New_York", workingHours: hoursFor(0, 0, 180), staffId: "s", appointments: [],
      durationMinutes: 15, bufferMinutes: 0, slotIntervalMinutes: 60, now: past,
    });
    // 00:00 EDT (-4), [01:00 ambiguous], 02:00 EST (-5).
    expect(startsOf(slots)).toEqual(["2026-11-01T04:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });

  it("fall-back day: no slot ends after the closing instant (duration + buffer measured in real minutes)", () => {
    const close = localWallTimeToUtc("2026-10-25", 4 * 60, "Europe/Berlin");
    const slots = calculateAvailability({
      dateIso: "2026-10-25", timeZone: "Europe/Berlin", workingHours: hoursFor(0, 0, 240), staffId: "s", appointments: [],
      durationMinutes: 45, bufferMinutes: 15, slotIntervalMinutes: 15, now: past,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.endAt.getTime() - slot.startAt.getTime()).toBe(60 * 60_000);
      expect(slot.endAt.getTime()).toBeLessThanOrEqual(close.getTime());
    }
  });
});

describe("service duration + buffer at the end of working hours (Istanbul, Monday 09:00-18:00)", () => {
  const monday = "2026-11-09";
  const base = {
    dateIso: monday, timeZone: "Europe/Istanbul", workingHours: hoursFor(1, 9 * 60, 18 * 60), staffId: "s", appointments: [],
    slotIntervalMinutes: 15, now: past,
  };
  const close = localWallTimeToUtc(monday, 18 * 60, "Europe/Istanbul");
  const last = (durationMinutes: number, bufferMinutes: number) =>
    calculateAvailability({ ...base, durationMinutes, bufferMinutes }).at(-1);

  it("the last slot's service + buffer ends exactly at closing time", () => {
    const slot = last(60, 15);
    expect(slot?.startAt).toEqual(localWallTimeToUtc(monday, 16 * 60 + 45, "Europe/Istanbul"));
    expect(slot?.endAt).toEqual(close);
  });

  it("one extra buffer minute moves the last slot back one interval (buffer counts toward closing)", () => {
    expect(last(60, 16)?.startAt).toEqual(localWallTimeToUtc(monday, 16 * 60 + 30, "Europe/Istanbul"));
    expect(last(60, 0)?.startAt).toEqual(localWallTimeToUtc(monday, 17 * 60, "Europe/Istanbul"));
  });

  it("no slot is offered when duration + buffer exceed the whole working window", () => {
    expect(calculateAvailability({ ...base, durationMinutes: 9 * 60, bufferMinutes: 0 })).toHaveLength(1);
    expect(calculateAvailability({ ...base, durationMinutes: 9 * 60, bufferMinutes: 1 })).toEqual([]);
  });

  it("the buffer of an existing appointment blocks a start that only overlaps the buffer", () => {
    // Existing 16:00-17:00 + 15 min buffer -> occupied until 17:15.
    const startAt = localWallTimeToUtc(monday, 16 * 60, "Europe/Istanbul");
    const existing = { id: "a", tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "c", startAt, endAt: new Date(startAt.getTime() + 75 * 60_000), status: "CONFIRMED" as const };
    const starts = startsOf(calculateAvailability({ ...base, durationMinutes: 30, bufferMinutes: 0, appointments: [existing] }));
    expect(starts).not.toContain(localWallTimeToUtc(monday, 17 * 60, "Europe/Istanbul").toISOString());
    expect(starts).toContain(localWallTimeToUtc(monday, 17 * 60 + 15, "Europe/Istanbul").toISOString());
  });
});

describe("closure boundary at local midnight (millisecond precision)", () => {
  const tz = "Europe/Istanbul";
  const closed = ["2026-11-10"];
  const midnight = localDayUtcRange("2026-11-10", tz).startAt; // 2026-11-09T21:00Z

  it("local midnight of the closed date is 21:00Z of the previous UTC day", () => {
    expect(midnight.toISOString()).toBe("2026-11-09T21:00:00.000Z");
    expect(utcToLocalDateAndMinute(midnight, tz)).toEqual({ dateIso: "2026-11-10", minute: 0 });
  });

  it("a slot ending exactly at midnight is open; one millisecond later touches the closed date", () => {
    const startAt = new Date(midnight.getTime() - 60 * 60_000);
    expect(isSlotOnClosedDate({ startAt, endAt: midnight }, tz, closed)).toBe(false);
    expect(isSlotOnClosedDate({ startAt, endAt: new Date(midnight.getTime() + 1) }, tz, closed)).toBe(true);
  });

  it("a slot starting exactly at midnight of the closed date is rejected; one ms earlier start is the open day", () => {
    const oneHour = 60 * 60_000;
    expect(isSlotOnClosedDate({ startAt: midnight, endAt: new Date(midnight.getTime() + oneHour) }, tz, closed)).toBe(true);
    const before = new Date(midnight.getTime() - 1);
    expect(isSlotOnClosedDate({ startAt: before, endAt: midnight }, tz, closed)).toBe(false);
  });
});
