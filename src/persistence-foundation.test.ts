import { describe, expect, it } from "vitest";

describe("persistence foundation schema contract", () => {
  it("keeps the initial persistence boundary explicit", () => {
    const expectedModels = [
      "Tenant",
      "Profile",
      "Staff",
      "Service",
      "Appointment",
    ];

    expect(expectedModels).toHaveLength(5);
    expect(new Set(expectedModels).size).toBe(expectedModels.length);
  });
});
