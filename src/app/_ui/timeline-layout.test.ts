import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  assignLanes,
  CALENDAR_RANGE_MAX_DAYS,
  computeRange,
  dateInZone,
  DEFAULT_TIMELINE_RANGE,
  formatMinute,
  initialScrollMinute,
  layoutColumn,
  minutesFromDayStart,
  minuteToPct,
  monthGrid,
  parseCalendarRange,
  placeInterval,
  placeVertical,
  startOfWeek,
  stepDate,
  ticks,
  todayInZone,
  viewDateRange,
  weekDates,
  weekdayIndex,
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

describe("parseCalendarRange (loader range validation)", () => {
  it("defaults the end to the start (single day)", () => {
    expect(parseCalendarRange("2026-11-05")).toEqual({ startDate: "2026-11-05", endDate: "2026-11-05" });
  });

  it("accepts up to 42 inclusive days and rejects 43", () => {
    expect(CALENDAR_RANGE_MAX_DAYS).toBe(42);
    expect(parseCalendarRange("2026-10-26", "2026-12-06")).toEqual({ startDate: "2026-10-26", endDate: "2026-12-06" });
    expect(parseCalendarRange("2026-10-26", "2026-12-07")).toBeNull();
  });

  it("rejects reversed, malformed, impossible and non-string dates", () => {
    expect(parseCalendarRange("2026-11-06", "2026-11-05")).toBeNull();
    expect(parseCalendarRange("2026-11-5", "2026-11-06")).toBeNull();
    expect(parseCalendarRange("2026-02-30", "2026-03-01")).toBeNull();
    expect(parseCalendarRange(20261105, "2026-11-06")).toBeNull();
    expect(parseCalendarRange("2026-11-05", { toString: () => "2026-11-06" })).toBeNull();
    expect(parseCalendarRange("2026-11-05T00:00:00Z")).toBeNull();
  });
});

describe("week and month grids", () => {
  it("weeks start on Monday", () => {
    expect(weekdayIndex("2026-11-02")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-08")).toBe(6); // Sunday
    expect(startOfWeek("2026-11-05")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(weekDates("2026-11-05")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
  });

  it("adds months with day clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", -1)).toBe("2026-02-15");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });

  it("covers the month with whole Mon–Sun weeks, never more than 42 days", () => {
    const november = monthGrid("2026-11-18");
    expect(november.month).toBe("2026-11");
    expect(november.startDate).toBe("2026-10-26");
    expect(november.endDate).toBe("2026-12-06");
    expect(november.weeks).toHaveLength(6);
    expect(november.weeks.every((week) => week.length === 7)).toBe(true);
    // February 2027 starts on Monday and has exactly four weeks.
    const february = monthGrid("2027-02-10");
    expect(february.weeks).toHaveLength(4);
    expect(february.startDate).toBe("2027-02-01");
    for (const iso of ["2026-01-01", "2026-05-31", "2026-08-15", "2027-03-01"]) {
      const grid = monthGrid(iso);
      expect(parseCalendarRange(grid.startDate, grid.endDate)).not.toBeNull();
    }
  });

  it("maps a view to the loader range and steps by the view's unit", () => {
    expect(viewDateRange("day", "2026-11-05")).toEqual({ startDate: "2026-11-05", endDate: "2026-11-05" });
    expect(viewDateRange("list", "2026-11-05")).toEqual({ startDate: "2026-11-05", endDate: "2026-11-05" });
    expect(viewDateRange("week", "2026-11-05")).toEqual({ startDate: "2026-11-02", endDate: "2026-11-08" });
    expect(viewDateRange("month", "2026-11-05")).toEqual({ startDate: "2026-10-26", endDate: "2026-12-06" });
    expect(stepDate("day", "2026-11-05", 1)).toBe("2026-11-06");
    expect(stepDate("week", "2026-11-05", -1)).toBe("2026-10-29");
    expect(stepDate("month", "2026-11-30", 1)).toBe("2026-12-30");
  });

  it("reads the local date of an instant in Europe/Istanbul", () => {
    expect(dateInZone("2026-11-05T20:59:00.000Z")).toBe("2026-11-05");
    expect(dateInZone("2026-11-05T21:00:00.000Z")).toBe("2026-11-06");
  });
});

describe("placeVertical", () => {
  const range = { startMin: 8 * 60, endMin: 21 * 60 };

  it("maps minutes to px from the range start", () => {
    expect(placeVertical({ startMin: 9 * 60, endMin: 9 * 60 + 30 }, range, 88)).toEqual({ top: 88, height: 44 });
  });

  it("enforces the minimum height (touch target) and clips to the range", () => {
    expect(placeVertical({ startMin: 10 * 60, endMin: 10 * 60 + 10 }, range, 88, 44)).toEqual({ top: 176, height: 44 });
    expect(placeVertical({ startMin: 7 * 60, endMin: 8 * 60 + 30 }, range, 88)).toEqual({ top: 0, height: 44 });
    expect(placeVertical({ startMin: 20 * 60 + 30, endMin: 22 * 60 }, range, 88)).toEqual({ top: 12.5 * 88, height: 44 });
  });
});

describe("layoutColumn", () => {
  it("keeps non-overlapping items full width", () => {
    const lanes = layoutColumn([
      { id: "a", startMin: 600, endMin: 630 },
      { id: "b", startMin: 630, endMin: 660 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, laneCount: 1 });
    expect(lanes.get("b")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("splits an overlap cluster into side-by-side lanes and resets after it", () => {
    const lanes = layoutColumn([
      { id: "a", startMin: 600, endMin: 660 },
      { id: "b", startMin: 615, endMin: 645 },
      { id: "c", startMin: 650, endMin: 700 },
      { id: "d", startMin: 720, endMin: 750 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, laneCount: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, laneCount: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, laneCount: 2 }); // reuses b's lane, still chained to a
    expect(lanes.get("d")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("treats short items as their minimum drawn duration", () => {
    const lanes = layoutColumn(
      [
        { id: "a", startMin: 600, endMin: 610 },
        { id: "b", startMin: 615, endMin: 645 },
      ],
      30,
    );
    expect(lanes.get("a")).toEqual({ lane: 0, laneCount: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, laneCount: 2 });
  });
});
