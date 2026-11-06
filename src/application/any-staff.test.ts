import { describe, expect, it } from "vitest";
import { dateInTimeZone, mergeAnyStaffSlots, staffOrderForSlot } from "./any-staff";

const slot = (hhmm: string) => ({ startAtIso: `2026-11-07T${hhmm}:00.000Z`, endAtIso: `2026-11-07T${hhmm}:30.000Z` });

describe("mergeAnyStaffSlots", () => {
  it("unions start times across staff without duplicates, in time order", () => {
    const merged = mergeAnyStaffSlots([
      { staffId: "a", slots: [slot("09:00"), slot("07:00")] },
      { staffId: "b", slots: [slot("07:00"), slot("08:00")] },
    ]);
    expect(merged.map((s) => s.startAtIso.slice(11, 16))).toEqual(["07:00", "08:00", "09:00"]);
  });

  it("is empty when nobody is free", () => {
    expect(mergeAnyStaffSlots([{ staffId: "a", slots: [] }])).toEqual([]);
  });
});

describe("staffOrderForSlot", () => {
  const perStaff = [
    { staffId: "busy", slots: [slot("07:00")] },
    { staffId: "free", slots: [slot("07:00"), slot("08:00"), slot("09:00")] },
    { staffId: "other", slots: [slot("08:00")] },
    { staffId: "tie", slots: [slot("07:00"), slot("10:00"), slot("11:00")] },
  ];

  it("lists only staff free at that time, least busy first, catalog order on ties", () => {
    expect(staffOrderForSlot(perStaff, "2026-11-07T07:00:00.000Z")).toEqual(["free", "tie", "busy"]);
  });

  it("matches the same instant written differently", () => {
    // 11:00 Istanbul = 08:00Z
    expect(staffOrderForSlot(perStaff, "2026-11-07T11:00:00+03:00")).toEqual(["free", "other"]);
  });

  it("returns nobody for a time no one offers", () => {
    expect(staffOrderForSlot(perStaff, "2026-11-07T12:00:00.000Z")).toEqual([]);
  });
});

describe("dateInTimeZone", () => {
  it("uses the salon's local date across midnight", () => {
    expect(dateInTimeZone(new Date("2026-11-06T22:30:00.000Z"), "Europe/Istanbul")).toBe("2026-11-07");
    expect(dateInTimeZone(new Date("2026-11-06T20:00:00.000Z"), "Europe/Istanbul")).toBe("2026-11-06");
  });
});
