import { describe, expect, it } from "vitest";
import { appointmentServiceLabel, combineServiceTimings, normalizeExtraServiceIds } from "./multi-service";

describe("combineServiceTimings", () => {
  it("keeps a single service unchanged", () => {
    expect(combineServiceTimings([{ durationMinutes: 30, bufferMinutes: 10 }])).toEqual({ durationMinutes: 30, bufferMinutes: 10 });
  });

  it("sums duration + buffer of every service; the last buffer stays the buffer", () => {
    const combined = combineServiceTimings([
      { durationMinutes: 30, bufferMinutes: 10 },
      { durationMinutes: 20, bufferMinutes: 5 },
    ]);
    expect(combined).toEqual({ durationMinutes: 60, bufferMinutes: 5 });
    expect(combined.durationMinutes + combined.bufferMinutes).toBe(65);
  });

  it("needs at least one service", () => {
    expect(() => combineServiceTimings([])).toThrow();
  });
});

describe("appointmentServiceLabel", () => {
  it("joins multi-service names in order and keeps single names", () => {
    expect(appointmentServiceLabel("Kesim", ["Kesim", "Sakal"])).toBe("Kesim + Sakal");
    expect(appointmentServiceLabel("Kesim", [])).toBe("Kesim");
    expect(appointmentServiceLabel("Kesim", ["Kesim"])).toBe("Kesim");
  });
});

describe("normalizeExtraServiceIds", () => {
  it("accepts absent, empty and valid lists", () => {
    expect(normalizeExtraServiceIds("a", undefined)).toEqual([]);
    expect(normalizeExtraServiceIds("a", [])).toEqual([]);
    expect(normalizeExtraServiceIds("a", ["b", "c"])).toEqual(["b", "c"]);
  });

  it("rejects duplicates, the primary repeated, bad ids and more than 4 extras", () => {
    for (const bad of [["b", "b"], ["a"], [""], [" b"], "b", [1], ["b", "c", "d", "e", "f"]]) {
      expect(normalizeExtraServiceIds("a", bad)).toBe("INVALID");
    }
  });
});
