import { describe, expect, it } from "vitest";

import { googleEventBody, mergeIntervals, planOutbound, subtractIntervals } from "./google-calendar-sync";
import { calculateAvailability } from "./availability";

const d = (iso: string) => new Date(iso);
const appt = (id: string, updated = "2026-11-19T10:00:00Z") => ({
  id, startAt: d("2026-11-20T07:00:00Z"), endAt: d("2026-11-20T07:30:00Z"), status: "CONFIRMED",
  customerName: "Ayşe", serviceLabel: "Kesim", staffName: null, updatedAt: d(updated),
});

describe("planOutbound", () => {
  it("creates new, patches changed and deletes gone appointments", () => {
    const plan = planOutbound([appt("new"), appt("same"), appt("changed", "2026-11-19T11:00:00Z")], [
      { appointmentId: "same", externalEventId: "e1", syncedUpdatedAt: d("2026-11-19T10:00:00Z") },
      { appointmentId: "changed", externalEventId: "e2", syncedUpdatedAt: d("2026-11-19T10:00:00Z") },
      { appointmentId: "cancelled", externalEventId: "e3", syncedUpdatedAt: d("2026-11-19T10:00:00Z") },
    ]);
    expect(plan.create.map((a) => a.id)).toEqual(["new"]);
    expect(plan.update.map((u) => [u.appointment.id, u.externalEventId])).toEqual([["changed", "e2"]]);
    expect(plan.remove.map((l) => l.externalEventId)).toEqual(["e3"]);
  });
});

describe("intervals", () => {
  it("merges overlapping busy time", () => {
    const merged = mergeIntervals([
      { startAt: d("2026-11-20T09:00:00Z"), endAt: d("2026-11-20T10:00:00Z") },
      { startAt: d("2026-11-20T08:00:00Z"), endAt: d("2026-11-20T09:30:00Z") },
      { startAt: d("2026-11-20T11:00:00Z"), endAt: d("2026-11-20T12:00:00Z") },
    ]);
    expect(merged.map((i) => [i.startAt.toISOString(), i.endAt.toISOString()])).toEqual([
      ["2026-11-20T08:00:00.000Z", "2026-11-20T10:00:00.000Z"],
      ["2026-11-20T11:00:00.000Z", "2026-11-20T12:00:00.000Z"],
    ]);
  });
  it("cuts the app's own appointments out of busy time", () => {
    const left = subtractIntervals([{ startAt: d("2026-11-20T08:00:00Z"), endAt: d("2026-11-20T10:00:00Z") }], [{ startAt: d("2026-11-20T08:30:00Z"), endAt: d("2026-11-20T09:00:00Z") }]);
    expect(left.map((i) => [i.startAt.toISOString(), i.endAt.toISOString()])).toEqual([
      ["2026-11-20T08:00:00.000Z", "2026-11-20T08:30:00.000Z"],
      ["2026-11-20T09:00:00.000Z", "2026-11-20T10:00:00.000Z"],
    ]);
  });
});

describe("googleEventBody", () => {
  it("marks pending as tentative and tags the appointment id", () => {
    const body = googleEventBody({ ...appt("a1"), status: "PENDING" }, "https://app/staff/calendar");
    expect(body.status).toBe("tentative");
    expect(body.summary).toContain("Ayşe — Kesim");
    expect(body.extendedProperties.private.randevunAppointmentId).toBe("a1");
  });
});

describe("calculateAvailability with busy intervals", () => {
  it("drops slots that overlap external busy time and keeps the rest", () => {
    const base = {
      dateIso: "2026-11-20", timeZone: "Europe/Istanbul", staffId: "s1", appointments: [],
      workingHours: [{ dayOfWeek: 5, openMinute: 600, closeMinute: 720 }] as never,
      durationMinutes: 30, bufferMinutes: 0, now: d("2026-11-19T00:00:00Z"),
    };
    const free = calculateAvailability(base).map((s) => s.startAt.toISOString());
    // 11:00–11:30 local (08:00–08:30 UTC) is busy in Google.
    const withBusy = calculateAvailability({ ...base, busyIntervals: [{ startAt: d("2026-11-20T08:00:00Z"), endAt: d("2026-11-20T08:30:00Z") }] }).map((s) => s.startAt.toISOString());
    expect(free).toContain("2026-11-20T08:00:00.000Z");
    expect(withBusy).not.toContain("2026-11-20T08:00:00.000Z");
    expect(withBusy).toContain("2026-11-20T08:30:00.000Z");
  });
});
