"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { MorphIcon } from "@/components/ui/motion-icons";
import { cx } from "@/lib/utils";
import {
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  writeThemePreference,
  type ThemePreference,
} from "./theme";
import { haptic } from "@/lib/haptics";
import { runThemeReveal } from "./theme-reveal";

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

const meta: Record<ThemePreference, { label: string; icon: typeof Sun }> = {
  system: { label: "Sistem", icon: SunMoon },
  light: { label: "Açık", icon: Sun },
  dark: { label: "Koyu", icon: Moon },
};

/**
 * Appearance button (Amicro btn-12 "Theme" morph): each tap cycles Sistem → Açık → Koyu.
 * The new theme opens as a circle from the button where the browser supports view transitions,
 * otherwise instantly. Persists on this device only (localStorage). Presentation only.
 */
export function ThemeToggle({ className = "", showLabel = false }: { className?: string; showLabel?: boolean }) {
  const current = useSyncExternalStore(subscribe, () => readThemePreference(), () => "system" as const);
  const next = nextThemePreference(current);
  const { label, icon } = meta[current];

  return (
    <button
      type="button"
      onClick={(event) => {
        haptic("selection");
        const box = event.currentTarget.getBoundingClientRect();
        runThemeReveal({
          apply: () => setPreference(next),
          origin: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          doc: document,
          reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        });
      }}
      aria-label={`Görünüm: ${label}. Değiştirmek için dokunun (sonraki: ${meta[next].label}).`}
      title={`Görünüm: ${label}`}
      className={cx(
        "pressable focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-separator bg-surface text-ink shadow-card hover:bg-surface-muted",
        showLabel ? "px-4" : "px-0",
        className,
      )}
    >
      <MorphIcon icon={icon} iconKey={current} className="size-5" />
      {showLabel ? (
        <span aria-hidden="true" className="text-footnote font-semibold">
          {label}
        </span>
      ) : null}
    </button>
  );
}
