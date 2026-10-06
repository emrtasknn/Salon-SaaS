import { describe, expect, it } from "vitest";
import { createStaffStatus, isStaffBookable } from "./staff";

describe("staff domain", () => {
  it("defaults to active", () => expect(createStaffStatus()).toBe("ACTIVE"));
  it("rejects invalid status", () => expect(() => createStaffStatus("PAUSED")).toThrow());
  it("marks only active staff bookable", () => {
    expect(isStaffBookable("ACTIVE")).toBe(true);
    expect(isStaffBookable("INACTIVE")).toBe(false);
  });
});
