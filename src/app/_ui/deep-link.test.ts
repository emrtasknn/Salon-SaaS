import { describe, expect, it } from "vitest";
import { appointmentHref, parseCalendarDeepLink } from "./deep-link";

describe("calendar deep links", () => {
  it("builds a link to the appointment's Istanbul day", () => {
    // 22:30 UTC on Nov 9 is Nov 10, 01:30 in Istanbul.
    expect(appointmentHref("/admin/calendar", { appointmentId: "abc_1", startAt: "2026-11-09T22:30:00.000Z" }))
      .toBe("/admin/calendar?date=2026-11-10&appointment=abc_1");
  });

  it("reads valid params and ignores malformed ones", () => {
    expect(parseCalendarDeepLink({ date: "2026-11-10", appointment: "abc_1" }, "2026-01-01"))
      .toEqual({ date: "2026-11-10", appointmentId: "abc_1" });
    expect(parseCalendarDeepLink({ date: "2026-02-30", appointment: "<script>" }, "2026-01-01"))
      .toEqual({ date: "2026-01-01", appointmentId: null });
    expect(parseCalendarDeepLink(undefined, "2026-01-01")).toEqual({ date: "2026-01-01", appointmentId: null });
  });
});
