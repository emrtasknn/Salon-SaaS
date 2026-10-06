import { describe, expect, it } from "vitest";
import { canTransitionAppointment, createAppointmentEnd, transitionAppointmentStatus } from "./appointment";

describe("appointment lifecycle", () => {
  it("allows only canonical transitions", () => {
    expect(canTransitionAppointment("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransitionAppointment("PENDING", "REJECTED")).toBe(true);
    expect(canTransitionAppointment("CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransitionAppointment("REJECTED", "CONFIRMED")).toBe(false);
    expect(canTransitionAppointment("COMPLETED", "CANCELLED")).toBe(false);
    expect(() => transitionAppointmentStatus("PENDING", "COMPLETED")).toThrow();
  });

  it("includes service buffer in appointment end", () => {
    const end = createAppointmentEnd(new Date("2026-10-06T09:00:00.000Z"), 60, 15);
    expect(end.toISOString()).toBe("2026-10-06T10:15:00.000Z");
  });
});
