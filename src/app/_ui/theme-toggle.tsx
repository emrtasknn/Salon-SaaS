"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  applyThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  writeThemePreference,
  type ThemePreference,
} from "./theme";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the preference: apply it here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyThemePreference(readThemePreference());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setPreference(preference: ThemePreference) {
  writeThemePreference(preference);
  applyThemePreference(preference);
  listeners.forEach((listener) => listener());
}

const options: ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  {
    value: "system",
    label: "Sistem",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 3a7 7 0 0 1 0 14Z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Açık",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Koyu",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" />
      </svg>
    ),
  },
];

/**
 * Appearance switch: "Sistem" (follow the device, default) / "Açık" / "Koyu".
 * Applies instantly and persists on this device only (localStorage). Presentation only.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const current = useSyncExternalStore(subscribe, () => readThemePreference(), () => "system" as const);

  return (
    <div
      role="group"
      aria-label="Görünüm"
      className={`inline-flex rounded-control border border-separator bg-surface-muted p-0.5 ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setPreference(option.value)}
            className={`pressable focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] px-3 text-footnote font-semibold ${
              selected ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
