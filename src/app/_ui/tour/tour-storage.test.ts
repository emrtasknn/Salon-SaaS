import { describe, expect, it } from "vitest";

import { hasSeenTour, markTourSeen, resetTour, tourStorageKey } from "./tour-storage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("tour storage", () => {
  it("uses a versioned key per area", () => {
    expect(tourStorageKey("admin")).toBe("salon-saas:tour:v1:admin");
    expect(tourStorageKey("staff")).toBe("salon-saas:tour:v2:staff");
  });

  it("is unseen until marked, then seen, then unseen again after a reset", () => {
    const storage = memoryStorage();
    expect(hasSeenTour(storage, "admin")).toBe(false);
    markTourSeen(storage, "admin", new Date("2026-11-19T10:00:00Z"));
    expect(storage.map.get(tourStorageKey("admin"))).toBe("2026-11-19T10:00:00.000Z");
    expect(hasSeenTour(storage, "admin")).toBe(true);
    expect(hasSeenTour(storage, "staff")).toBe(false);
    resetTour(storage, "admin");
    expect(hasSeenTour(storage, "admin")).toBe(false);
  });

  it("treats missing or blocked storage as seen, so the tour never loops", () => {
    expect(hasSeenTour(null, "admin")).toBe(true);
    expect(hasSeenTour(throwing, "admin")).toBe(true);
  });

  it("never throws when writing to blocked or missing storage", () => {
    expect(() => markTourSeen(throwing, "staff")).not.toThrow();
    expect(() => resetTour(throwing, "staff")).not.toThrow();
    expect(() => markTourSeen(null, "staff")).not.toThrow();
    expect(() => resetTour(null, "staff")).not.toThrow();
  });
});
