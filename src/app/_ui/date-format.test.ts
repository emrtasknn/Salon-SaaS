import { describe, expect, it } from "vitest";
import { formatAppointmentDateTime, formatDateInZone, formatDayLabel, formatIsoDayLabel } from "./date-format";

describe("formatAppointmentDateTime", () => {
  it("shows the salon's wall-clock time, not the server's UTC time", () => {
    // 08:00 UTC is 11:00 in Istanbul.
    expect(formatAppointmentDateTime("2026-11-07T08:00:00.000Z")).toBe("7 Kas Cmt 11:00");
  });

  it("uses the salon's calendar day near midnight", () => {
    // 22:30 UTC on the 6th is 01:30 on the 7th in Istanbul.
    expect(formatAppointmentDateTime(new Date("2026-11-06T22:30:00.000Z"))).toBe("7 Kas Cmt 01:30");
  });

  it("accepts another time zone", () => {
    expect(formatAppointmentDateTime("2026-11-07T08:00:00.000Z", "UTC")).toBe("7 Kas Cmt 08:00");
  });
});

describe("formatDateInZone", () => {
  it("formats the salon's calendar date", () => {
    expect(formatDateInZone("2026-11-06T22:30:00.000Z")).toBe("07.11.2026");
  });
});

describe("formatDayLabel", () => {
  it("uses the salon's day", () => {
    expect(formatDayLabel("2026-11-06T22:30:00.000Z")).toBe("7 Kas Cmt");
  });
});

describe("formatIsoDayLabel", () => {
  it("marks today", () => {
    expect(formatIsoDayLabel("2026-11-06", "2026-11-06")).toBe("Bugün · 6 Kas Cum");
  });
  it("shows other days plainly", () => {
    expect(formatIsoDayLabel("2026-11-07", "2026-11-06")).toBe("7 Kas Cmt");
  });
});
