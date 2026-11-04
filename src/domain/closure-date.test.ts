import { describe, expect, it } from "vitest";
import {
  closureDateFromDb, closureDateToDb, isPastLocalDate, normalizeClosureReason, parseClosureDate, parseClosureRange, tenantLocalToday,
  upcomingClosureRange,
} from "./closure-date";

describe("upcomingClosureRange (WP-08 admin list window)", () => {
  it.each([
    "2026-11-04T10:00:00.000Z",
    "2027-02-28T23:59:59.000Z", // window crosses a year end
    "2027-03-01T00:00:00.000Z", // window contains 29 Feb 2028 (leap day)
    "2028-12-31T23:00:00.000Z",
  ])("is accepted by parseClosureRange at %s", (iso) => {
    const range = upcomingClosureRange(new Date(iso));
    expect(parseClosureRange(range.from, range.to)).toEqual(range);
  });

  it("starts one day before UTC today and covers tenant-local today in far-east and far-west zones", () => {
    const now = new Date("2026-11-04T23:30:00.000Z");
    const range = upcomingClosureRange(now);
    expect(range.from).toBe("2026-11-03");
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Istanbul"]) {
      const today = tenantLocalToday(now, tz);
      expect(today >= range.from && today <= range.to).toBe(true);
    }
  });
});

describe("closure date (WP-08)", () => {
  it("accepts only real calendar dates YYYY-MM-DD", () => {
    expect(parseClosureDate("2026-11-09")).toBe("2026-11-09");
    expect(parseClosureDate("2028-02-29")).toBe("2028-02-29");
    for (const bad of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-09", " 2026-11-09", "2026-11-09T00:00", "", null, 20261109, "1969-12-31"]) {
      expect(parseClosureDate(bad)).toBeNull();
    }
  });

  it("normalizes the optional reason: trim, blank -> null, <= 200 chars, no control characters", () => {
    expect(normalizeClosureReason(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeClosureReason(null)).toEqual({ ok: true, value: null });
    expect(normalizeClosureReason("   ")).toEqual({ ok: true, value: null });
    expect(normalizeClosureReason("  Bayram  ")).toEqual({ ok: true, value: "Bayram" });
    expect(normalizeClosureReason("x".repeat(200))).toEqual({ ok: true, value: "x".repeat(200) });
    expect(normalizeClosureReason("x".repeat(201))).toEqual({ ok: false });
    expect(normalizeClosureReason("a\nb")).toEqual({ ok: false });
    expect(normalizeClosureReason(42)).toEqual({ ok: false });
  });

  it("compares against the tenant-local today, not UTC", () => {
    // 2026-11-09 22:30 UTC is 2026-11-10 01:30 in Istanbul.
    const now = new Date("2026-11-09T22:30:00.000Z");
    expect(tenantLocalToday(now, "Europe/Istanbul")).toBe("2026-11-10");
    expect(isPastLocalDate("2026-11-09", now, "Europe/Istanbul")).toBe(true);
    expect(isPastLocalDate("2026-11-10", now, "Europe/Istanbul")).toBe(false);
    expect(isPastLocalDate("2026-11-09", now, "UTC")).toBe(false);
  });

  it("round-trips the Prisma DATE representation", () => {
    expect(closureDateToDb("2026-11-09")).toEqual(new Date("2026-11-09T00:00:00.000Z"));
    expect(closureDateFromDb(new Date("2026-11-09T00:00:00.000Z"))).toBe("2026-11-09");
    expect(() => closureDateToDb("2026-02-30")).toThrow(TypeError);
  });

  it("validates list ranges", () => {
    expect(parseClosureRange("2026-11-01", "2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(parseClosureRange("2026-11-30", "2026-11-01")).toBeNull();
    expect(parseClosureRange("2026-01-01", "2027-01-02")).toEqual({ from: "2026-01-01", to: "2027-01-02" });
    expect(parseClosureRange("2026-01-01", "2027-01-03")).toBeNull();
    expect(parseClosureRange("bad", "2026-11-01")).toBeNull();
  });
});
