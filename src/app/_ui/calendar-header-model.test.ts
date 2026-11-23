import { describe, expect, it } from "vitest";

import { compactPeriodLabel, loadDateRange, shiftWeek, showsToday, swipeDirection, weekStripDays } from "./calendar-header-model";
import { liveAppointmentDates } from "./calendar-marks";

describe("compactPeriodLabel", () => {
  it("names the day without the year in the current year", () => {
    expect(compactPeriodLabel("day", "2026-11-19", "2026-11-19")).toBe("19 Kasım Perşembe");
    expect(compactPeriodLabel("list", "2027-01-04", "2026-11-19")).toContain("2027");
  });
  it("shortens weeks and names months", () => {
    expect(compactPeriodLabel("week", "2026-11-19", "2026-11-19")).toBe("16–22 Kasım");
    expect(compactPeriodLabel("week", "2026-12-01", "2026-11-19")).toBe("30 Kas–6 Ara");
    expect(compactPeriodLabel("month", "2026-11-19", "2026-11-19")).toBe("Kasım 2026");
  });
});

describe("loadDateRange", () => {
  it("loads the whole week for day and list, the view's own range otherwise", () => {
    expect(loadDateRange("day", "2026-11-19")).toEqual({ startDate: "2026-11-16", endDate: "2026-11-22" });
    expect(loadDateRange("list", "2026-11-22")).toEqual({ startDate: "2026-11-16", endDate: "2026-11-22" });
    expect(loadDateRange("week", "2026-11-19")).toEqual({ startDate: "2026-11-16", endDate: "2026-11-22" });
    expect(loadDateRange("month", "2026-11-19").startDate).toBe("2026-10-26");
  });
});

describe("weekStripDays", () => {
  it("returns Monday to Sunday with selection, today and marks", () => {
    const days = weekStripDays("2026-11-19", "2026-11-18", new Set(["2026-11-20"]));
    expect(days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(days[0].weekday).toBe("Pzt");
    expect(days.find((d) => d.selected)?.date).toBe("2026-11-19");
    expect(days.find((d) => d.today)?.date).toBe("2026-11-18");
    expect(days.filter((d) => d.marked).map((d) => d.dayOfMonth)).toEqual(["20"]);
  });
});

describe("swipe and week shift", () => {
  it("treats only clearly horizontal travel as a swipe", () => {
    expect(swipeDirection(-80, 10)).toBe(1);
    expect(swipeDirection(80, 10)).toBe(-1);
    expect(swipeDirection(30, 0)).toBe(0);
    expect(swipeDirection(-80, 70)).toBe(0);
  });
  it("keeps the weekday when moving a week", () => {
    expect(shiftWeek("2026-11-19", 1)).toBe("2026-11-26");
    expect(shiftWeek("2026-11-19", -1)).toBe("2026-11-12");
  });
});

describe("showsToday", () => {
  it("knows when Bugün would change nothing", () => {
    expect(showsToday("day", "2026-11-19", "2026-11-19")).toBe(true);
    expect(showsToday("day", "2026-11-18", "2026-11-19")).toBe(false);
    expect(showsToday("week", "2026-11-16", "2026-11-19")).toBe(true);
    expect(showsToday("month", "2026-11-02", "2026-11-19")).toBe(true);
    expect(showsToday("month", "2026-12-02", "2026-11-19")).toBe(false);
  });
});

describe("liveAppointmentDates", () => {
  it("marks local dates of live appointments only", () => {
    const marks = liveAppointmentDates([
      { startAt: "2026-11-19T21:30:00.000Z", status: "CONFIRMED" }, // 00:30 on the 20th in Istanbul
      { startAt: new Date("2026-11-19T08:00:00.000Z"), status: "PENDING" },
      { startAt: "2026-11-21T08:00:00.000Z", status: "CANCELLED" },
    ]);
    expect([...marks].sort()).toEqual(["2026-11-19", "2026-11-20"]);
  });
});
