import { describe, expect, it } from "vitest";

import { formatHoursRange, minutesToTime, timeToMinutes } from "./time-of-day";

describe("minutesToTime", () => {
  it("formats minutes after midnight as HH:MM", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(1080)).toBe("18:00");
    expect(minutesToTime(1435)).toBe("23:55");
    expect(minutesToTime(1439)).toBe("23:59");
  });

  it("returns an empty string for out-of-range or non-integer values", () => {
    expect(minutesToTime(-1)).toBe("");
    expect(minutesToTime(1440)).toBe("");
    expect(minutesToTime(9.5)).toBe("");
    expect(minutesToTime(Number.NaN)).toBe("");
  });
});

describe("timeToMinutes", () => {
  it("parses HH:MM", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("18:00")).toBe(1080);
    expect(timeToMinutes("23:55")).toBe(1435);
  });

  it("accepts a seconds suffix", () => {
    expect(timeToMinutes("09:30:00")).toBe(570);
  });

  it("returns null for invalid input", () => {
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("9:00")).toBeNull();
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("12:60")).toBeNull();
    expect(timeToMinutes("ab:cd")).toBeNull();
    expect(timeToMinutes("540")).toBeNull();
  });

  it("round-trips with minutesToTime", () => {
    for (const minutes of [0, 5, 540, 1080, 1435]) {
      expect(timeToMinutes(minutesToTime(minutes))).toBe(minutes);
    }
  });
});

describe("formatHoursRange", () => {
  it("formats a friendly range", () => {
    expect(formatHoursRange(540, 1080)).toBe("09:00–18:00");
  });

  it("is empty when a bound is invalid", () => {
    expect(formatHoursRange(540, 2000)).toBe("");
  });
});
