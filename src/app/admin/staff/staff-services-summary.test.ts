import { describe, expect, it } from "vitest";
import { staffServicesSummary } from "./staff-management";

describe("staffServicesSummary", () => {
  it("says every service when the staff member has no mapping or all of them", () => {
    expect(staffServicesSummary([], 5)).toBe("Tüm hizmetler");
    expect(staffServicesSummary(["a", "b"], 2)).toBe("Tüm hizmetler");
  });

  it("counts a partial mapping", () => {
    expect(staffServicesSummary(["a", "b"], 5)).toBe("2 / 5 hizmet");
  });
});
