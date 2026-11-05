// Theme preference (presentation only; never carries authorization or domain meaning).
// "system" follows the device via the CSS `prefers-color-scheme` query in globals.css, so no
// matchMedia listener is needed; "light" / "dark" pin the theme through <html data-theme>.

export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export const THEME_STORAGE_KEY = "randevun-theme";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the stored preference; any failure (private mode, blocked storage) falls back to "system". */
export function readThemePreference(storage: ReadableStorage | null = defaultStorage()): ThemePreference {
  if (!storage) return "system";
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Persists the preference ("system" clears the key). Storage failures are ignored. */
export function writeThemePreference(
  preference: ThemePreference,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (preference === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Preference simply won't survive a reload.
  }
}

type ThemeRoot = Pick<HTMLElement, "setAttribute" | "removeAttribute">;

/** Applies the preference to <html>: "system" removes `data-theme` so the CSS media query decides. */
export function applyThemePreference(preference: ThemePreference, root: ThemeRoot | null = defaultRoot()): void {
  if (!root) return;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

function defaultRoot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

/**
 * Inline <head> script run before first paint so a pinned theme never flashes the other one.
 * Kept tiny and self-contained (no imports); mirrors readThemePreference + applyThemePreference.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
