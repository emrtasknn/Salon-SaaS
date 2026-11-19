import { describe, expect, it } from "vitest";

import { staffHomeSummary, startsInLabel } from "./home-summary";

// Europe/Istanbul is UTC+3 all year.
const at = (local: string) => new Date(`${local}+03:00`).toISOString();
const appt = (id: string, start: string, end: string, status = "CONFIRMED") => ({ id, startAt: at(start), endAt: at(end), status });

describe("staffHomeSummary", () => {
  const now = Date.parse(at("2026-11-19T12:10:00"));
  const items = [
    appt("past", "2026-11-19T09:00:00", "2026-11-19T09:30:00"),
    appt("running", "2026-11-19T12:00:00", "2026-11-19T12:45:00"),
    appt("later", "2026-11-19T15:00:00", "2026-11-19T15:30:00", "PENDING"),
    appt("cancelled", "2026-11-19T16:00:00", "2026-11-19T16:30:00", "CANCELLED"),
    appt("tomorrow", "2026-11-20T10:00:00", "2026-11-20T10:30:00", "PENDING"),
  ];
  const summary = staffHomeSummary(items, now, "2026-11-19");

  it("counts today's live appointments, and those not yet over", () => {
    expect(summary.today.map((a) => a.id)).toEqual(["past", "running", "later"]);
    expect(summary.todayRemaining).toBe(2);
  });

  it("picks the running appointment as next, starting now", () => {
    expect(summary.next?.id).toBe("running");
    expect(summary.nextStartsInMinutes).toBe(0);
  });

  it("lists upcoming pending requests soonest first and ignores ended statuses", () => {
    expect(summary.pending.map((a) => a.id)).toEqual(["later", "tomorrow"]);
    expect(summary.weekCount).toBe(4);
  });

  it("has no next appointment when everything is over", () => {
    const late = staffHomeSummary(items.slice(0, 1), now, "2026-11-19");
    expect(late.next).toBeNull();
    expect(late.nextStartsInMinutes).toBeNull();
  });
});

describe("startsInLabel", () => {
  it("speaks in minutes and hours today, in days later", () => {
    expect(startsInLabel(0, at("2026-11-19T12:00:00"), "2026-11-19")).toBe("Şimdi");
    expect(startsInLabel(25, at("2026-11-19T12:35:00"), "2026-11-19")).toBe("25 dk sonra");
    expect(startsInLabel(120, at("2026-11-19T14:10:00"), "2026-11-19")).toBe("2 sa sonra");
    expect(startsInLabel(125, at("2026-11-19T14:15:00"), "2026-11-19")).toBe("2 sa 5 dk sonra");
    expect(startsInLabel(1300, at("2026-11-20T10:00:00"), "2026-11-19")).toBe("Yarın");
    expect(startsInLabel(4000, at("2026-11-22T10:00:00"), "2026-11-19")).toBe("3 gün sonra");
  });
});
