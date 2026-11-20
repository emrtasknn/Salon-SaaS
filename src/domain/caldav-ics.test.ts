import { describe, expect, it } from "vitest";

import { etagOf, parseDurationMs, parsePhoneEvent, unfoldIcs } from "./caldav-ics";

const wrap = (lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
const TZ = "Europe/Istanbul";

describe("parsePhoneEvent", () => {
  it("reads an iPhone event with TZID, title and end", () => {
    const ics = wrap([
      "BEGIN:VTIMEZONE", "TZID:Europe/Istanbul", "END:VTIMEZONE",
      "BEGIN:VEVENT", "UID:ABC-1", "DTSTART;TZID=Europe/Istanbul:20261125T140000", "DTEND;TZID=Europe/Istanbul:20261125T150000",
      "SUMMARY:Ayşe saç\\, boya", "BEGIN:VALARM", "TRIGGER:-PT15M", "SUMMARY:alarm", "END:VALARM", "END:VEVENT",
    ]);
    expect(parsePhoneEvent(ics, TZ)).toEqual({
      uid: "ABC-1", title: "Ayşe saç, boya",
      startAt: new Date("2026-11-25T11:00:00.000Z"), endAt: new Date("2026-11-25T12:00:00.000Z"),
      blocksTime: true, recurring: false,
    });
  });

  it("handles UTC, floating time (salon zone), DURATION and a missing end", () => {
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "DURATION:PT45M", "END:VEVENT"]), TZ)?.endAt).toEqual(new Date("2026-11-25T08:45:00.000Z"));
    const floating = parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T100000", "END:VEVENT"]), TZ);
    expect(floating?.startAt).toEqual(new Date("2026-11-25T07:00:00.000Z"));
    expect(floating?.endAt).toEqual(new Date("2026-11-25T07:30:00.000Z"));
  });

  it("never lets all-day, free or cancelled events close slots", () => {
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART;VALUE=DATE:20261125", "DTEND;VALUE=DATE:20261126", "END:VEVENT"]), TZ)?.blocksTime).toBe(false);
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "TRANSP:TRANSPARENT", "END:VEVENT"]), TZ)?.blocksTime).toBe(false);
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "STATUS:CANCELLED", "END:VEVENT"]), TZ)?.blocksTime).toBe(false);
  });

  it("flags recurrence, unfolds long lines and rejects broken events", () => {
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "RRULE:FREQ=WEEKLY", "END:VEVENT"]), TZ)?.recurring).toBe(true);
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "SUMMARY:Uzun", " başlık", "END:VEVENT"]), TZ)?.title).toBe("Uzunbaşlık");
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "DTSTART:20261125T080000Z", "END:VEVENT"]), TZ)).toBeNull();
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "END:VEVENT"]), TZ)).toBeNull();
    expect(parsePhoneEvent(wrap(["BEGIN:VEVENT", "UID:u", "DTSTART:20261125T080000Z", "DTEND:20261125T070000Z", "END:VEVENT"]), TZ)).toBeNull();
    expect(parsePhoneEvent("garbage", TZ)).toBeNull();
  });

  it("parses durations and unfolds", () => {
    expect(parseDurationMs("PT1H30M")).toBe(90 * 60_000);
    expect(parseDurationMs("P1D")).toBe(86_400_000);
    expect(parseDurationMs("P")).toBeNull();
    expect(unfoldIcs("A:1\r\n 2\r\nB:3")).toEqual(["A:12", "B:3"]);
    expect(etagOf("x")).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
  });
});
