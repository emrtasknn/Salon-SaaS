"use client";

import { useSyncExternalStore } from "react";
import { haptic, hapticsEnabled, HAPTICS_STORAGE_KEY, setHapticsEnabled } from "@/lib/haptics";
import { switchClassName } from "./styles";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === HAPTICS_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** "Titreşim" switch (per device). On by default. Presentation only. */
export function HapticsToggle() {
  const enabled = useSyncExternalStore(subscribe, () => hapticsEnabled(), () => true);
  return (
    <label className="inline-flex min-h-11 items-center gap-2 rounded-full border border-separator bg-surface px-3.5 text-footnote font-semibold text-ink shadow-card">
      Titreşim
      <input
        type="checkbox"
        role="switch"
        aria-checked={enabled}
        checked={enabled}
        onChange={(event) => {
          setHapticsEnabled(event.target.checked);
          listeners.forEach((listener) => listener());
          if (event.target.checked) haptic("selection");
        }}
        className={switchClassName}
      />
    </label>
  );
}
