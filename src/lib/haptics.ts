// Haptic feedback for touch devices. Presentation only: never tied to authorization or data.
//
// - Android / Chrome: Vibration API patterns (adapted from Amicro `use-web-haptics`, MIT).
// - iOS 18+ Safari / PWA: there is no Vibration API, but toggling an <input type="checkbox" switch>
//   during a user gesture plays the system selection tick. iOS only allows it inside a tap, so a
//   haptic fired after an async server result is silently skipped there (expected).
// - Users can turn it off (Hesap → Titreşim); stored per device.

export type HapticKind = "selection" | "light" | "medium" | "success" | "warning" | "error";

export const HAPTICS_STORAGE_KEY = "randevun-haptics";

export const VIBRATION_PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 8,
  light: 10,
  medium: 25,
  success: [15, 60, 15],
  warning: [30, 60, 30],
  error: [60, 60, 60, 60, 60],
};

/** Number of iOS switch ticks per kind (iOS has a single tick strength). */
const IOS_TICKS: Record<HapticKind, number> = { selection: 1, light: 1, medium: 1, success: 2, warning: 2, error: 3 };

type HapticsEnv = {
  storage?: Pick<Storage, "getItem"> | null;
  vibrate?: ((pattern: number | number[]) => boolean) | null;
  iosTick?: (() => void) | null;
};

export function hapticsEnabled(storage: Pick<Storage, "getItem"> | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(HAPTICS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean, storage: Pick<Storage, "setItem" | "removeItem"> | null = defaultStorage()) {
  try {
    if (enabled) storage?.removeItem(HAPTICS_STORAGE_KEY);
    else storage?.setItem(HAPTICS_STORAGE_KEY, "off");
  } catch {
    // Preference simply won't persist.
  }
}

/** Plays a haptic if the device supports one and the user has not turned it off. Returns whether it fired. */
export function haptic(kind: HapticKind = "selection", env: HapticsEnv = defaultEnv()): boolean {
  if (!hapticsEnabled(env.storage ?? null)) return false;
  try {
    if (env.vibrate) return env.vibrate(VIBRATION_PATTERNS[kind]);
    if (env.iosTick) {
      const tick = env.iosTick;
      tick();
      for (let i = 1; i < IOS_TICKS[kind]; i++) setTimeout(tick, i * 90);
      return true;
    }
  } catch {
    // Haptics are best effort.
  }
  return false;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function iosSwitchTick() {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

function defaultEnv(): HapticsEnv {
  if (typeof window === "undefined") return {};
  const nav = window.navigator;
  return {
    storage: defaultStorage(),
    vibrate: typeof nav.vibrate === "function" ? (pattern) => nav.vibrate(pattern) : null,
    iosTick: typeof nav.vibrate !== "function" && isIos() ? iosSwitchTick : null,
  };
}
