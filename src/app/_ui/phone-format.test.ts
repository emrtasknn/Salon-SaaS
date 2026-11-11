import { describe, expect, it } from "vitest";
import { formatPhone } from "./phone-format";

describe("formatPhone", () => {
  it("groups a Turkish E.164 number", () => {
    expect(formatPhone("+905050626252")).toBe("+90 505 062 62 52");
  });

  it("groups a national number written with a leading zero", () => {
    expect(formatPhone("05050626252")).toBe("0505 062 62 52");
  });

  it("ignores spaces, dashes and brackets already in the value", () => {
    expect(formatPhone("+90 (505) 062-62-52")).toBe("+90 505 062 62 52");
  });

  it("returns other numbers trimmed and unchanged", () => {
    expect(formatPhone(" +4915112345678 ")).toBe("+4915112345678");
    expect(formatPhone("12345")).toBe("12345");
  });
});
