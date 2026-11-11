import { describe, expect, it } from "vitest";
import { formatAppointmentDateTime, formatDateFieldLabel, formatDateInZone, formatDayLabel, formatIsoDayLabel, formatShortDate } from "./date-format";

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

describe("formatDateFieldLabel", () => {
  it("writes a wall date as day, short month and year", () => {
    expect(formatDateFieldLabel("2026-11-10")).toBe("10 Kas 2026");
  });

  it("never shifts the day with the server's time zone", () => {
    expect(formatDateFieldLabel("2026-01-01")).toBe("1 Oca 2026");
  });
});

describe("formatShortDate", () => {
  it("drops the year inside the current year", () => {
    expect(formatShortDate("2026-11-06T09:00:00.000Z", new Date("2026-11-10T09:00:00.000Z"))).toBe("6 Kas");
  });

  it("keeps the year for older dates", () => {
    expect(formatShortDate("2025-12-30T09:00:00.000Z", new Date("2026-11-10T09:00:00.000Z"))).toBe("30 Ara 2025");
  });

  it("uses the salon's calendar day", () => {
    expect(formatShortDate("2026-11-06T22:30:00.000Z", new Date("2026-11-10T09:00:00.000Z"))).toBe("7 Kas");
  });
});
