import { describe, expect, it } from "vitest";
import {
  createWorkingHoursCloseMinute,
  createWorkingHoursDay,
  createWorkingHoursOpenMinute,
  createWorkingHoursRecord,
  isMinuteRangeWithinWorkingHours,
} from "./working-hours";

describe("working hours domain", () => {
  it("accepts weekly day and minute boundaries", () => {
    expect(createWorkingHoursDay(0)).toBe(0);
    expect(createWorkingHoursDay(6)).toBe(6);
    expect(createWorkingHoursOpenMinute(9 * 60)).toBe(540);
    expect(createWorkingHoursCloseMinute(18 * 60)).toBe(1080);
  });

  it("rejects invalid day and minute values", () => {
    expect(() => createWorkingHoursDay(-1)).toThrow();
    expect(() => createWorkingHoursDay(7)).toThrow();
    expect(() => createWorkingHoursOpenMinute(1440)).toThrow();
    expect(() => createWorkingHoursCloseMinute(-1)).toThrow();
  });

  it("requires a positive same-day interval", () => {
    expect(() => createWorkingHoursRecord({
      id: "wh_1", tenantId: "tenant_1", dayOfWeek: 1, openMinute: 600, closeMinute: 600,
    })).toThrow();
    expect(() => createWorkingHoursRecord({
      id: "wh_1", tenantId: "tenant_1", dayOfWeek: 1, openMinute: 700, closeMinute: 600,
    })).toThrow();
  });

  it("checks whether a slot fits entirely inside the working interval", () => {
    expect(isMinuteRangeWithinWorkingHours(540, 1080, 600, 675)).toBe(true);
    expect(isMinuteRangeWithinWorkingHours(540, 1080, 530, 675)).toBe(false);
    expect(isMinuteRangeWithinWorkingHours(540, 1080, 600, 1090)).toBe(false);
  });
});
