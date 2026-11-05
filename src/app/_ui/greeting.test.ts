import { describe, expect, it } from "vitest";

import { formatGreetingDate, localDateIso } from "./greeting";

describe("greeting date helpers", () => {
  it("uses the Istanbul calendar day, not UTC", () => {
    // 2026-11-05 22:30 UTC is already 2026-11-06 01:30 in Istanbul (UTC+3).
    const lateUtc = new Date("2026-11-05T22:30:00Z");
    expect(localDateIso(lateUtc)).toBe("2026-11-06");
    expect(formatGreetingDate(lateUtc)).toContain("6 Kasım");
  });

  it("formats day, month and weekday in Turkish", () => {
    const text = formatGreetingDate(new Date("2026-11-05T09:00:00Z"));
    expect(text).toContain("5 Kasım");
    expect(text).toContain("Perşembe");
  });
});
