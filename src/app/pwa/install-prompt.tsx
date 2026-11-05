"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INSTALL_PROMPT_DISMISSED_KEY,
  INSTALL_PROMPT_DISMISSED_VALUE,
  isInstallPromptDismissed,
  isIosSafari,
  isStandalone,
  shouldShowInstallPrompt,
  type InstallPromptVariant,
} from "./install-prompt-state";

const STANDALONE_QUERY = "(display-mode: standalone)";

/** Chromium-only event; not in the TypeScript DOM lib. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function readDismissed(): boolean {
  try {
    return isInstallPromptDismissed(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY));
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, INSTALL_PROMPT_DISMISSED_VALUE);
  } catch {
    // Storage may be unavailable (private mode, quota); dismissal then lasts for this page view only.
  }
}

function readStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return isStandalone({
    displayModeStandalone:
      typeof window.matchMedia === "function"
        ? window.matchMedia(STANDALONE_QUERY).matches
        : undefined,
    navigatorStandalone: nav.standalone,
  });
}

type EnvironmentSnapshot = "standalone" | "ios-safari" | "other";

function subscribeToEnvironment(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getEnvironmentSnapshot(): EnvironmentSnapshot {
  if (readStandalone()) return "standalone";
  return isIosSafari({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  })
    ? "ios-safari"
    : "other";
}

// Nothing is rendered on the server or during hydration; the banner appears after mount.
function getServerEnvironmentSnapshot(): EnvironmentSnapshot {
  return "standalone";
}

function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * Small, dismissible install banner. UI-only: install/dismiss state is never used
 * for auth, tenant or appointment decisions.
 *
 * Layout: fixed to the bottom edge with safe-area padding, plus an in-flow spacer of
 * the same height so the end of the page (including booking CTAs) can always be
 * scrolled clear of the banner.
 */
export function InstallPrompt() {
  const environment = useSyncExternalStore(
    subscribeToEnvironment,
    getEnvironmentSnapshot,
    getServerEnvironmentSnapshot,
  );
  const storedDismissal = useSyncExternalStore(subscribeToNothing, readDismissed, () => true);
  const [dismissedNow, setDismissedNow] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // If our banner will not show, leave the browser's own install UI alone.
      if (readDismissed() || readStandalone()) return;
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const variant: InstallPromptVariant | null = installed
    ? null
    : shouldShowInstallPrompt({
        standalone: environment === "standalone",
        dismissed: storedDismissal || dismissedNow,
        hasDeferredPrompt: deferredPrompt !== null || installing,
        iosSafari: environment === "ios-safari",
      });

  if (variant === null) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissedNow(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // The browser may reject a reused or expired prompt; the banner is hidden below either way.
    } finally {
      // A beforeinstallprompt event can only be used once; the browser fires a new one if it is still installable.
      setDeferredPrompt(null);
      setInstalling(false);
    }
  };

  return (
    <>
      <div aria-hidden="true" data-install-banner-spacer="" className="h-[calc(4.5rem+env(safe-area-inset-bottom))] shrink-0" />
      <section
        aria-label="Uygulamayı yükle"
        data-install-banner=""
        className="glass fixed inset-x-0 bottom-0 z-40 border-t px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-ink"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 sm:gap-3">
          <p className="min-w-0 flex-1 text-sm leading-snug">
            {variant === "native" ? (
              <>
                <span className="font-medium">Ana ekrana ekle</span>
                <span className="hidden text-ink-muted sm:inline"> · RandevuN’u uygulama gibi aç.</span>
              </>
            ) : (
              <>
                <span className="font-medium">Ana ekrana ekle:</span>{" "}
                <span className="text-ink-muted">
                  Paylaş <span aria-hidden="true">(⬆︎)</span> → Ana Ekrana Ekle
                </span>
              </>
            )}
          </p>
          {variant === "native" ? (
            <Button type="button" onClick={install} pending={installing} size="small" className="min-h-11 shrink-0" leadingIcon={Download}>
              Uygulamayı yükle
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            iconOnly
            leadingIcon={X}
            onClick={dismiss}
            aria-label="Yükleme önerisini kapat"
            className="shrink-0 text-ink-muted hover:text-ink"
          />
        </div>
      </section>
    </>
  );
}
