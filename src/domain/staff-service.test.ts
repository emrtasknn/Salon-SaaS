import { describe, expect, it } from "vitest";
import { staffPerformsService } from "./staff-service";

describe("staffPerformsService", () => {
  it("lets staff without a mapping perform every service", () => {
    expect(staffPerformsService([], "svc-1")).toBe(true);
  });

  it("limits mapped staff to their services", () => {
    expect(staffPerformsService(["svc-1", "svc-2"], "svc-2")).toBe(true);
    expect(staffPerformsService(["svc-1"], "svc-2")).toBe(false);
  });
});
