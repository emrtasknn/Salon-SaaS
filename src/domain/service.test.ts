import { describe, expect, it } from "vitest";
import {
  SERVICE_NAME_MAX_LENGTH,
  archivedServiceNameCandidates,
  chooseArchivedServiceName,
  createServiceBufferMinutes,
  createServiceDurationMinutes,
  createServiceRecord,
  isServiceBookable,
  normalizeServiceName,
} from "./service";

describe("service domain", () => {
  it("normalizes a valid name", () => {
    expect(normalizeServiceName("  Haircut  ")).toBe("Haircut");
  });

  it("rejects empty and control-character names", () => {
    expect(() => normalizeServiceName("   ")).toThrow();
    expect(() => normalizeServiceName("Hair\ncut")).toThrow();
  });

  it("validates duration and buffer", () => {
    expect(createServiceDurationMinutes(60)).toBe(60);
    expect(createServiceBufferMinutes(15)).toBe(15);
    expect(() => createServiceDurationMinutes(0)).toThrow();
    expect(() => createServiceDurationMinutes(1.5)).toThrow();
    expect(() => createServiceBufferMinutes(-1)).toThrow();
  });

  it("defaults a service to active and only active services are bookable", () => {
    const service = createServiceRecord({
      id: "service-1",
      tenantId: "tenant-1",
      name: "Haircut",
      durationMinutes: 60,
      bufferMinutes: 15,
    });

    expect(service.active).toBe(true);
    expect(isServiceBookable(service.active)).toBe(true);
    expect(isServiceBookable(false)).toBe(false);
  });
});

describe("archived service name reuse", () => {
  it("appends the plain suffix", () => {
    expect(chooseArchivedServiceName("Haircut", new Set())).toBe("Haircut (silindi)");
  });

  it("numbers the suffix when earlier names are taken", () => {
    expect(chooseArchivedServiceName("Haircut", new Set(["Haircut (silindi)"]))).toBe("Haircut (silindi 2)");
    expect(
      chooseArchivedServiceName("Haircut", new Set(["Haircut (silindi)", "Haircut (silindi 2)"])),
    ).toBe("Haircut (silindi 3)");
  });

  it("truncates the base name, not the suffix, and trims trailing whitespace", () => {
    const long = "a".repeat(SERVICE_NAME_MAX_LENGTH);
    const chosen = chooseArchivedServiceName(long, new Set());
    expect(chosen).toBe(`${"a".repeat(SERVICE_NAME_MAX_LENGTH - " (silindi)".length)} (silindi)`);
    expect(chosen?.length).toBe(SERVICE_NAME_MAX_LENGTH);

    const spaced = `${"a".repeat(109)} ${"b".repeat(11)}`;
    expect(chooseArchivedServiceName(spaced, new Set())).toBe(`${"a".repeat(109)} (silindi)`);
    for (const candidate of archivedServiceNameCandidates(long)) {
      expect(candidate.length).toBeLessThanOrEqual(SERVICE_NAME_MAX_LENGTH);
    }
  });

  it("returns null when all 50 candidates are taken", () => {
    const taken = new Set(archivedServiceNameCandidates("Haircut"));
    expect(taken.size).toBe(50);
    expect(chooseArchivedServiceName("Haircut", taken)).toBeNull();
  });
});
