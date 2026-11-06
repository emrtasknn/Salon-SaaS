import { describe, expect, it } from "vitest";
import { setupSteps } from "./setup-steps";

describe("setupSteps", () => {
  it("lists every step in order for a brand-new salon", () => {
    const steps = setupSteps({ staffCount: 0, serviceCount: 0, openDays: 0, legalMissing: true });
    expect(steps.map((s) => [s.href, s.done])).toEqual([
      ["/admin/staff", false],
      ["/admin/services", false],
      ["/admin/hours", false],
      ["/admin/salon", false],
    ]);
  });

  it("marks finished steps as done", () => {
    const steps = setupSteps({ staffCount: 1, serviceCount: 2, openDays: 6, legalMissing: true });
    expect(steps.filter((s) => !s.done).map((s) => s.href)).toEqual(["/admin/salon"]);
  });

  it("treats unknown counts as done so a load error never nags", () => {
    const steps = setupSteps({ staffCount: null, serviceCount: null, openDays: null, legalMissing: false });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});
