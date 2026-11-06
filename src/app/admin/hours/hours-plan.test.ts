import { describe, expect, it } from "vitest";
import { planHoursChanges } from "./hours-plan";

const saved = [
  { dayOfWeek: 1, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 2, openMinute: 540, closeMinute: 1080 },
];
const draft = (dayOfWeek: number, open: boolean, openMinute: number | null = 540, closeMinute: number | null = 1080) => ({
  dayOfWeek,
  open,
  openMinute,
  closeMinute,
});

describe("planHoursChanges", () => {
  it("returns no changes when the draft matches the saved week", () => {
    expect(planHoursChanges(saved, [draft(0, false), draft(1, true), draft(2, true)])).toEqual({ status: "ok", changes: [] });
  });

  it("saves new and changed days and closes days switched off", () => {
    const plan = planHoursChanges(saved, [draft(0, true, 600, 900), draft(1, true, 540, 1020), draft(2, false)]);
    expect(plan).toEqual({
      status: "ok",
      changes: [
        { kind: "save", dayOfWeek: 0, openMinute: 600, closeMinute: 900 },
        { kind: "save", dayOfWeek: 1, openMinute: 540, closeMinute: 1020 },
        { kind: "close", dayOfWeek: 2 },
      ],
    });
  });

  it("ignores closed days that were already closed", () => {
    expect(planHoursChanges([], [draft(3, false)])).toEqual({ status: "ok", changes: [] });
  });

  it("rejects an open day whose close is not after open, before sending anything", () => {
    expect(planHoursChanges(saved, [draft(1, true, 1080, 1080), draft(2, false)])).toEqual({ status: "invalid", dayOfWeek: 1 });
    expect(planHoursChanges(saved, [draft(4, true, null, 600)])).toEqual({ status: "invalid", dayOfWeek: 4 });
  });
});
