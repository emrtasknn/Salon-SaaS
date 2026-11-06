import { describe, expect, it } from "vitest";
import { canCompleteAppointment, canTransitionAppointment, createAppointmentEnd, transitionAppointmentStatus } from "./appointment";

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

describe("completion time rule (owner decision 2026-11-06)", () => {
  const startAt = new Date("2026-11-07T08:00:00.000Z");
  it("cannot complete before the appointment starts", () => {
    expect(canCompleteAppointment({ status: "CONFIRMED", startAt }, new Date("2026-11-07T07:59:59.000Z"))).toBe(false);
  });
  it("can complete from the start time on", () => {
    expect(canCompleteAppointment({ status: "CONFIRMED", startAt }, startAt)).toBe(true);
    expect(canCompleteAppointment({ status: "CONFIRMED", startAt }, new Date("2026-11-08T08:00:00.000Z"))).toBe(true);
  });
  it("only a confirmed appointment can be completed", () => {
    expect(canCompleteAppointment({ status: "PENDING", startAt }, new Date("2026-11-08T00:00:00.000Z"))).toBe(false);
    expect(canCompleteAppointment({ status: "CANCELLED", startAt }, new Date("2026-11-08T00:00:00.000Z"))).toBe(false);
  });
});
