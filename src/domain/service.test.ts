import { describe, expect, it } from "vitest";
import {
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
