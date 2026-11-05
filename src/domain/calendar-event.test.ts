import { describe, expect, it } from "vitest";
import {
  appointmentCalendarEvent,
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
  formatCalendarUtc,
  isCalendarEligible,
  type CalendarEvent,
} from "./calendar-event";

const STATUS_URL = "https://app.example.com/salon-a/randevu/tok_123";

const input = {
  calendarUid: "appt-1@salon-saas",
  serviceName: "Saç Kesimi",
  salonName: "Salon A",
  staffName: "Ali",
  salonAddress: "Bağdat Cad. 1, Kadıköy; İstanbul",
  startAtIso: "2026-11-12T07:30:00.000Z",
  endAtIso: "2026-11-12T08:15:00.000Z",
  status: "CONFIRMED" as const,
  statusUrl: STATUS_URL,
};

const encoder = new TextEncoder();

describe("formatCalendarUtc", () => {
  it("formats as UTC YYYYMMDDTHHMMSSZ regardless of input offset", () => {
    expect(formatCalendarUtc(new Date("2026-11-12T10:30:05+03:00"))).toBe("20261112T073005Z");
    expect(formatCalendarUtc(new Date("2026-01-02T03:04:05.999Z"))).toBe("20260102T030405Z");
  });

  it("rejects invalid dates", () => {
    expect(() => formatCalendarUtc(new Date("nope"))).toThrow(RangeError);
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
  });
});

describe("foldIcsLine", () => {
  it("leaves lines of at most 75 octets unchanged", () => {
    const line = "X".repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it("folds long lines with CRLF + space and keeps every line within 75 octets", () => {
    const line = `DESCRIPTION:${"ğ".repeat(100)}${"a".repeat(50)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    // Unfolding restores the original without splitting multi-byte characters.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    expect(folded).not.toContain("�");
  });
});

describe("buildIcsCalendar", () => {
  const now = new Date("2026-11-05T09:00:00.000Z");
  const ics = buildIcsCalendar(appointmentCalendarEvent(input), now);
  const unfolded = ics.replace(/\r\n /g, "");
  const lines = unfolded.split("\r\n");

  it("uses CRLF line endings only", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n")) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
  });

  it("contains the event with UTC times, stable UID, status and escaped text", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("UID:appt-1@salon-saas");
    expect(lines).toContain("DTSTAMP:20261105T090000Z");
    expect(lines).toContain("DTSTART:20261112T073000Z");
    expect(lines).toContain("DTEND:20261112T081500Z");
    expect(lines).toContain("SEQUENCE:0");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("SUMMARY:Saç Kesimi — Salon A");
    expect(lines).toContain("LOCATION:Bağdat Cad. 1\\, Kadıköy\\; İstanbul");
    expect(lines).toContain(
      `DESCRIPTION:Personel: Ali\\n${STATUS_URL}\\nRandevunuzu bu bağlantıdan yönetebilirsiniz.`,
    );
    expect(lines.at(-2)).toBe("END:VCALENDAR");
  });

  it("adds a DISPLAY alarm 60 minutes before inside the event", () => {
    const alarmStart = lines.indexOf("BEGIN:VALARM");
    const alarmEnd = lines.indexOf("END:VALARM");
    expect(alarmStart).toBeGreaterThan(lines.indexOf("BEGIN:VEVENT"));
    expect(alarmEnd).toBeLessThan(lines.indexOf("END:VEVENT"));
    const alarm = lines.slice(alarmStart, alarmEnd);
    expect(alarm).toContain("ACTION:DISPLAY");
    expect(alarm).toContain("TRIGGER:-PT60M");
  });

  it("marks pending appointments TENTATIVE and omits LOCATION when no address", () => {
    const pending = buildIcsCalendar(
      appointmentCalendarEvent({ ...input, status: "PENDING", salonAddress: "  " }),
      now,
    );
    expect(pending).toContain("STATUS:TENTATIVE");
    expect(pending).not.toContain("LOCATION:");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("builds an encoded TEMPLATE link with UTC dates", () => {
    const url = new URL(buildGoogleCalendarUrl(appointmentCalendarEvent(input)));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Saç Kesimi — Salon A");
    expect(url.searchParams.get("dates")).toBe("20261112T073000Z/20261112T081500Z");
    expect(url.searchParams.get("details")).toBe(
      `Personel: Ali\n${STATUS_URL}\nRandevunuzu bu bağlantıdan yönetebilirsiniz.`,
    );
    expect(url.searchParams.get("location")).toBe("Bağdat Cad. 1, Kadıköy; İstanbul");
    expect(url.search).not.toMatch(/[ \n]/);
  });

  it("encodes reserved characters and omits location when absent", () => {
    const event: CalendarEvent = {
      ...appointmentCalendarEvent(input),
      title: "A&B=C #1 + %",
      location: null,
    };
    const raw = buildGoogleCalendarUrl(event);
    expect(raw).toContain("text=A%26B%3DC%20%231%20%2B%20%25");
    expect(raw).not.toContain("location=");
  });
});

describe("isCalendarEligible", () => {
  const now = new Date("2026-11-05T09:00:00.000Z");
  const future = new Date("2026-11-05T09:00:01.000Z");
  it("allows only open, future appointments", () => {
    expect(isCalendarEligible("PENDING", future, now)).toBe(true);
    expect(isCalendarEligible("CONFIRMED", future, now)).toBe(true);
    expect(isCalendarEligible("CONFIRMED", now, now)).toBe(false);
    for (const status of ["REJECTED", "CANCELLED", "COMPLETED"]) {
      expect(isCalendarEligible(status, future, now)).toBe(false);
    }
  });
});
