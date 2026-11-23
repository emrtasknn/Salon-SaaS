import { describe, expect, it } from "vitest";

import { minuteAtOffset } from "./timeline-layout";
import { slotNearMinute } from "../create-appointment-dialog";

describe("minuteAtOffset", () => {
  const range = { startMin: 9 * 60, endMin: 18 * 60 };
  it("maps a tap to the quarter hour above it", () => {
    // pad 10px, 88px per hour: 10 + 88 * 1.5 = 142px → 10:30
    expect(minuteAtOffset(142, range, 88, 10)).toBe(10 * 60 + 30);
    expect(minuteAtOffset(150, range, 88, 10)).toBe(10 * 60 + 30);
    expect(minuteAtOffset(165, range, 88, 10)).toBe(10 * 60 + 45);
  });
  it("stays inside the visible range", () => {
    expect(minuteAtOffset(-50, range, 88, 10)).toBe(9 * 60);
    expect(minuteAtOffset(5000, range, 88, 10)).toBe(18 * 60 - 15);
  });
});

describe("slotNearMinute", () => {
  // Istanbul is UTC+3: 07:00Z = 10:00 local.
  const slots = [{ startAt: "2026-11-19T07:00:00.000Z" }, { startAt: "2026-11-19T07:30:00.000Z" }, { startAt: "2026-11-19T09:00:00.000Z" }];
  it("picks the first free slot at or after the tapped time within an hour", () => {
    expect(slotNearMinute(slots, "2026-11-19", 10 * 60)).toBe("2026-11-19T07:00:00.000Z");
    expect(slotNearMinute(slots, "2026-11-19", 10 * 60 + 15)).toBe("2026-11-19T07:30:00.000Z");
  });
  it("leaves the choice to the user when nothing is close", () => {
    expect(slotNearMinute(slots, "2026-11-19", 10 * 60 + 45)).toBe("");
  });
});
