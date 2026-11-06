import { describe, expect, it } from "vitest";
import { dateStrip, formatDateLong, formatDateShort, formatTime, groupSlots, initialStep } from "./booking-steps";

describe("initialStep", () => {
  it("starts at the service list without a preselected service", () => {
    expect(initialStep("")).toBe(1);
  });

  it("skips to staff and time when the service came from the salon page", () => {
    expect(initialStep("svc-1")).toBe(2);
  });
});

describe("dateStrip", () => {
  it("returns consecutive salon-local dates across a month boundary", () => {
    const days = dateStrip("2026-11-29", 4);
    expect(days.map((d) => d.iso)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(days[2].day).toBe("1");
  });

  it("defaults to 14 days with Turkish labels", () => {
    const days = dateStrip("2026-11-07");
    expect(days).toHaveLength(14);
    expect(days[0].weekday).toBe("Cmt");
    expect(days[0].month).toBe("Kas");
  });
});

describe("formatting", () => {
  it("writes the long date without shifting the day", () => {
    expect(formatDateLong("2026-11-07")).toBe("7 Kasım Cumartesi");
  });

  it("writes a compact date for the action bar", () => {
    expect(formatDateShort("2026-11-07")).toBe("7 Kas Cmt");
  });

  it("shows times in the salon time zone", () => {
    expect(formatTime("2026-11-07T08:00:00.000Z", "Europe/Istanbul")).toBe("11:00");
  });
});

describe("groupSlots", () => {
  const at = (hhmm: string) => ({ startAtIso: `2026-11-07T${hhmm}:00.000Z` });

  it("groups by salon-local hour and drops empty groups", () => {
    // Istanbul is UTC+3: 06:00Z = 09:00, 10:30Z = 13:30, 14:00Z = 17:00
    const groups = groupSlots([at("06:00"), at("10:30"), at("14:00")], "Europe/Istanbul");
    expect(groups.map((g) => [g.label, g.slots.length])).toEqual([
      ["Sabah", 1],
      ["Öğleden sonra", 1],
      ["Akşam", 1],
    ]);
    expect(groupSlots([at("06:00")], "Europe/Istanbul").map((g) => g.label)).toEqual(["Sabah"]);
  });
});
