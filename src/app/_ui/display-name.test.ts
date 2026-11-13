import { describe, expect, it } from "vitest";
import { greetingName, initials } from "./display-name";

describe("greetingName", () => {
  it("greets by the first name", () => {
    expect(greetingName("Emre Taşkın")).toBe("Emre");
  });

  it("keeps a single-word name", () => {
    expect(greetingName("  Zeynep ")).toBe("Zeynep");
  });

  it("keeps the name after a title", () => {
    expect(greetingName("Dr. Ayşe Yılmaz")).toBe("Dr. Ayşe");
  });

  it("returns null when there is no name", () => {
    expect(greetingName(null)).toBeNull();
    expect(greetingName("   ")).toBeNull();
  });
});

describe("initials", () => {
  it("uses the first and last word", () => {
    expect(initials("Zeynep Kaya")).toBe("ZK");
    expect(initials("Ali Can Demir")).toBe("AD");
  });

  it("uses one letter for a single word", () => {
    expect(initials("Saat1508")).toBe("S");
  });

  it("upper-cases with Turkish rules", () => {
    expect(initials("ışık inci")).toBe("Iİ");
  });

  it("falls back to a question mark", () => {
    expect(initials("  ")).toBe("?");
  });
});
