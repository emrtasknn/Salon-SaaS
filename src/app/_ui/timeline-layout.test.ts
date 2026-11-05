import { describe, expect, it } from "vitest";
import {
  addDays,
  assignLanes,
  computeRange,
  DEFAULT_TIMELINE_RANGE,
  formatMinute,
  initialScrollMinute,
  minutesFromDayStart,
  minuteToPct,
  placeInterval,
  ticks,
  todayInZone,
} from "./timeline-layout";

describe("minutesFromDayStart", () => {
  it("converts UTC instants to Europe/Istanbul wall minutes (UTC+3)", () => {
    expect(minutesFromDayStart("2026-11-05T06:30:00.000Z", "2026-11-05")).toBe(9 * 60 + 30);
    expect(minutesFromDayStart(new Date("2026-11-05T20:59:00.000Z"), "2026-11-05")).toBe(23 * 60 + 59);
  });

  it("is relative to the selected day across midnight", () => {
    expect(minutesFromDayStart("2026-11-05T21:30:00.000Z", "2026-11-05")).toBe(24 * 60 + 30);
    expect(minutesFromDayStart("2026-11-04T20:00:00.000Z", "2026-11-05")).toBe(-60);
  });

  it("honours an explicit zone", () => {
    expect(minutesFromDayStart("2026-11-05T06:30:00.000Z", "2026-11-05", "UTC")).toBe(6 * 60 + 30);
  });
});

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns today in the tenant zone", () => {
    expect(todayInZone("Europe/Istanbul", new Date("2026-11-05T22:30:00.000Z"))).toBe("2026-11-06");
    expect(todayInZone("UTC", new Date("2026-11-05T22:30:00.000Z"))).toBe("2026-11-05");
  });
});

describe("computeRange", () => {
  it("defaults to 08:00–21:00", () => {
    expect(computeRange([])).toEqual(DEFAULT_TIMELINE_RANGE);
  });

  it("extends to whole hours that fit every appointment", () => {
    expect(computeRange([{ startMin: 7 * 60 + 15, endMin: 8 * 60 }, { startMin: 20 * 60 + 30, endMin: 21 * 60 + 10 }])).toEqual({
      startMin: 7 * 60,
      endMin: 22 * 60,
    });
  });

  it("clamps to the day", () => {
    expect(computeRange([{ startMin: -30, endMin: 25 * 60 }])).toEqual({ startMin: 0, endMin: 24 * 60 });
  });

  it("uses a provided base range", () => {
    expect(computeRange([], { startMin: 10 * 60, endMin: 18 * 60 + 30 })).toEqual({ startMin: 600, endMin: 19 * 60 });
  });
});

describe("placement", () => {
  const range = { startMin: 8 * 60, endMin: 18 * 60 };

  it("maps minutes to percentages", () => {
    expect(placeInterval({ startMin: 9 * 60, endMin: 10 * 60 }, range)).toEqual({ leftPct: 10, widthPct: 10 });
  });

  it("clips intervals to the range", () => {
    expect(placeInterval({ startMin: 7 * 60, endMin: 9 * 60 }, range)).toEqual({ leftPct: 0, widthPct: 10 });
    expect(placeInterval({ startMin: 19 * 60, endMin: 20 * 60 }, range)).toEqual({ leftPct: 100, widthPct: 0 });
  });

  it("positions single minutes and rejects out-of-range ones", () => {
    expect(minuteToPct(13 * 60, range)).toBe(50);
    expect(minuteToPct(7 * 60, range)).toBeNull();
  });

  it("emits hour and half-hour ticks", () => {
    expect(ticks({ startMin: 480, endMin: 600 })).toEqual([
      { minute: 480, kind: "hour" },
      { minute: 510, kind: "half" },
      { minute: 540, kind: "hour" },
      { minute: 570, kind: "half" },
      { minute: 600, kind: "hour" },
    ]);
  });

  it("formats minutes as HH:MM", () => {
    expect(formatMinute(8 * 60 + 5)).toBe("08:05");
    expect(formatMinute(24 * 60)).toBe("00:00");
  });
});

describe("assignLanes", () => {
  it("keeps non-overlapping and touching items in one lane", () => {
    const { lanes, laneCount } = assignLanes([
      { id: "b", startMin: 600, endMin: 660 },
      { id: "a", startMin: 540, endMin: 600 },
    ]);
    expect(laneCount).toBe(1);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(0);
  });

  it("stacks overlapping items and reuses freed lanes", () => {
    const { lanes, laneCount } = assignLanes([
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 560, endMin: 620 },
      { id: "c", startMin: 570, endMin: 580 },
      { id: "d", startMin: 600, endMin: 630 },
    ]);
    expect(laneCount).toBe(3);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(2);
    expect(lanes.get("d")).toBe(0);
  });

  it("reports at least one lane for an empty row", () => {
    expect(assignLanes([]).laneCount).toBe(1);
  });
});

describe("initialScrollMinute", () => {
  const range = { startMin: 480, endMin: 1260 };

  it("prefers the current hour when visible", () => {
    expect(initialScrollMinute(range, 600, 14 * 60 + 40)).toBe(14 * 60);
  });

  it("falls back to the first appointment hour, then the range start", () => {
    expect(initialScrollMinute(range, 11 * 60 + 15, null)).toBe(11 * 60);
    expect(initialScrollMinute(range, 11 * 60 + 15, 23 * 60)).toBe(11 * 60);
    expect(initialScrollMinute(range, null, null)).toBe(480);
  });
});
