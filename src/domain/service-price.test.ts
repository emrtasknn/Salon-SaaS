import { describe, expect, it } from "vitest";
import {
  SERVICE_PRICE_MAX_MINOR,
  createServicePrice,
  formatServicePrice,
  parseTryAmount,
} from "./service-price";

describe("parseTryAmount (Turkish input → kuruş)", () => {
  it("reads whole lira", () => {
    expect(parseTryAmount("450")).toBe(45000);
    expect(parseTryAmount(" 450 ₺ ")).toBe(45000);
    expect(parseTryAmount("450 TL")).toBe(45000);
  });
  it("reads a decimal comma and dot thousands", () => {
    expect(parseTryAmount("450,5")).toBe(45050);
    expect(parseTryAmount("450,50")).toBe(45050);
    expect(parseTryAmount("1.250")).toBe(125000);
    expect(parseTryAmount("1.250,75")).toBe(125075);
  });
  it("accepts a decimal dot when it is not a thousands group", () => {
    expect(parseTryAmount("99.9")).toBe(9990);
  });
  it("returns null for an empty value (price not shown)", () => {
    expect(parseTryAmount("")).toBeNull();
    expect(parseTryAmount("   ")).toBeNull();
  });
  it("rejects text, negatives, three decimals and out-of-range values", () => {
    for (const bad of ["abc", "-5", "1,234", "12,3,4", "100001", "1e3"]) {
      expect(parseTryAmount(bad)).toBe("INVALID");
    }
  });
});

describe("createServicePrice", () => {
  it("allows no price", () => {
    expect(createServicePrice(null, false)).toEqual({ priceMinor: null, priceIsFrom: false });
  });
  it("allows a price and a starting price", () => {
    expect(createServicePrice(45000, false)).toEqual({ priceMinor: 45000, priceIsFrom: false });
    expect(createServicePrice(45000, true)).toEqual({ priceMinor: 45000, priceIsFrom: true });
    expect(createServicePrice(0, false)).toEqual({ priceMinor: 0, priceIsFrom: false });
  });
  it("rejects a starting price without a price, fractions of kuruş and out-of-range values", () => {
    expect(() => createServicePrice(null, true)).toThrow(TypeError);
    expect(() => createServicePrice(10.5, false)).toThrow(TypeError);
    expect(() => createServicePrice(-1, false)).toThrow(TypeError);
    expect(() => createServicePrice(SERVICE_PRICE_MAX_MINOR + 1, false)).toThrow(TypeError);
    expect(() => createServicePrice("450" as unknown, false)).toThrow(TypeError);
    expect(() => createServicePrice(100, "yes" as unknown)).toThrow(TypeError);
  });
});

describe("formatServicePrice", () => {
  it("shows whole lira without decimals", () => {
    expect(formatServicePrice(45000, false)).toBe("₺450");
    expect(formatServicePrice(125000, false)).toBe("₺1.250");
  });
  it("shows kuruş when present", () => {
    expect(formatServicePrice(45050, false)).toBe("₺450,50");
  });
  it("marks a starting price without Turkish suffix guessing", () => {
    expect(formatServicePrice(45000, true)).toBe("₺450 ve üzeri");
  });
  it("returns null when there is no price", () => {
    expect(formatServicePrice(null, false)).toBeNull();
    expect(formatServicePrice(undefined, false)).toBeNull();
  });
});
