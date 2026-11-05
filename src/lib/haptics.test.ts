import { describe, expect, it, vi } from "vitest";
import { haptic, hapticsEnabled, HAPTICS_STORAGE_KEY, setHapticsEnabled, VIBRATION_PATTERNS } from "./haptics";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("haptics", () => {
  it("is a no-op on the server", () => {
    expect(haptic("success")).toBe(false);
  });

  it("vibrates with the pattern for the kind on Android-like devices", () => {
    const vibrate = vi.fn(() => true);
    expect(haptic("success", { storage: memoryStorage(), vibrate })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(VIBRATION_PATTERNS.success);
  });

  it("uses the iOS switch tick when there is no Vibration API", () => {
    const iosTick = vi.fn();
    expect(haptic("selection", { storage: memoryStorage(), vibrate: null, iosTick })).toBe(true);
    expect(iosTick).toHaveBeenCalledTimes(1);
  });

  it("respects the per-device off switch", () => {
    const storage = memoryStorage();
    setHapticsEnabled(false, storage);
    expect(storage.getItem(HAPTICS_STORAGE_KEY)).toBe("off");
    expect(hapticsEnabled(storage)).toBe(false);
    const vibrate = vi.fn(() => true);
    expect(haptic("light", { storage, vibrate })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true, storage);
    expect(hapticsEnabled(storage)).toBe(true);
  });
});
