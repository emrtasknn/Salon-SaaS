import { describe, expect, it } from "vitest";

import { buildCalendarFeed, calendarFeedPath, feedEventTitle, feedWindow, generateCalendarFeedToken, hashCalendarFeedToken } from "./calendar-feed";

describe("calendar feed token", () => {
  it("stores only a sha-256 hex of a 43-char base64url token", () => {
    const { token, tokenHash } = generateCalendarFeedToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCalendarFeedToken(token)).toBe(tokenHash);
    expect(hashCalendarFeedToken(`${token}.ics`)).toBe(tokenHash);
  });
  it("rejects anything malformed", () => {
    expect(hashCalendarFeedToken("short")).toBeNull();
    expect(hashCalendarFeedToken(`${"a".repeat(43)}.txt`)).toBeNull();
    expect(hashCalendarFeedToken(42)).toBeNull();
  });
  it("builds the path with the slug and .ics suffix", () => {
    expect(calendarFeedPath("salon-a", "abc")).toBe("/salon-a/takvim/abc.ics");
  });
});

describe("feed window", () => {
  it("covers 30 days back and 180 days ahead", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    const { from, to } = feedWindow(now);
    expect(from.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-05-18T00:00:00.000Z");
  });
});

describe("buildCalendarFeed", () => {
  const appointment = {
    id: "appt-1",
    startAt: new Date("2026-11-20T07:00:00Z"),
    endAt: new Date("2026-11-20T07:45:00Z"),
    status: "PENDING",
    customerName: "Ayşe Yılmaz, Jr.",
    serviceLabel: "Saç kesimi",
    staffName: "Elif",
    updatedAt: new Date("2026-11-19T10:00:00Z"),
  };
  const ics = buildCalendarFeed({ calendarName: "RandevuN — Salon", appointments: [appointment], now: new Date("2026-11-19T12:00:00Z"), appUrl: "https://app.example/staff/calendar" });

  it("is a CRLF VCALENDAR with name and refresh hint", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:RandevuN — Salon");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M");
  });
  it("writes one event per appointment with stable UID and escaped text", () => {
    expect(ics).toContain("UID:appt-1@randevun");
    expect(ics).toContain("DTSTART:20261120T070000Z");
    expect(ics).toContain("STATUS:TENTATIVE");
    expect(ics).toContain("SUMMARY:⏳ Ayşe Yılmaz\\, Jr. — Saç kesimi (Elif)");
    expect(ics).toContain("SEQUENCE:");
  });
  it("names the event after customer and service", () => {
    expect(feedEventTitle({ ...appointment, status: "CONFIRMED", staffName: null })).toBe("Ayşe Yılmaz, Jr. — Saç kesimi");
  });
  it("keeps every line within 75 octets", () => {
    const long = buildCalendarFeed({ calendarName: "x", appointments: [{ ...appointment, customerName: "Ğ".repeat(80) }], now: new Date(), appUrl: null });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
