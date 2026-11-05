"use client";

import { useEffect, useRef, useState } from "react";
import {
  getWebPushConfigAction,
  subscribeWebPushAction,
  unsubscribeWebPushAction,
} from "../push-actions";
import { isIosSafari, isStandalone } from "./install-prompt-state";
import {
  PUSH_BINDING_MARKER_KEY,
  PUSH_OPT_OUT_KEY,
  base64UrlToUint8Array,
  decidePushSync,
  decidePushUi,
  subscribeFailureMessage,
  toSubscribeInput,
  type PushPermission,
} from "./push-state";

/*
 * WP-09 Web Push opt-in. UI-only: the server derives tenant/profile from the
 * session; `bindingKey` and the localStorage markers are never used for auth.
 */

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the next mount then rebinds with a fresh endpoint.
  }
}

function readStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return isStandalone({
    displayModeStandalone:
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)").matches
        : undefined,
    navigatorStandalone: nav.standalone,
  });
}

function readPermission(): PushPermission | undefined {
  return typeof Notification === "undefined" ? undefined : Notification.permission;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    // The registrar registers on window load; wait briefly instead of forever.
    return await withTimeout(navigator.serviceWorker.ready, 3000);
  } catch {
    return undefined;
  }
}

async function subscribeBrowser(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
}

/**
 * Best-effort release of this device's subscription (logout). Never throws and
 * gives up after a short timeout so logout is never blocked.
 */
export async function releaseWebPushSubscription(): Promise<void> {
  try {
    await withTimeout(
      (async () => {
        if (typeof window === "undefined" || !("PushManager" in window)) return;
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        writeStorage(PUSH_BINDING_MARKER_KEY, null);
        if (!subscription) return;
        try {
          await unsubscribeWebPushAction({ endpoint: subscription.endpoint });
        } catch {
          // Server row is revoked later on 404/410 if this fails.
        }
        await subscription.unsubscribe();
      })(),
      3000,
    );
  } catch {
    // Never block logout.
  }
}

type View =
  | { kind: "hidden" }
  | { kind: "install-hint" }
  | { kind: "denied" }
  | { kind: "off"; message?: string }
  | { kind: "on"; message?: string };

/** UI-only: "Daha sonra" on the opt-in banner. Never used for auth or subscription state. */
export const PUSH_PROMPT_DISMISSED_KEY = "salon-saas:push-prompt-dismissed";
/** UI-only: the "blocked in device settings" hint is shown once per device. */
export const PUSH_DENIED_HINT_SHOWN_KEY = "salon-saas:push-denied-hint-shown";

type Props = {
  /** Opaque, non-authoritative key of the signed-in tenant/profile (server-hashed). */
  bindingKey: string;
  /**
   * Classes for the full-width banner (off / install hint / denied). The compact
   * bell (on, or off after "Daha sonra") renders inline without them.
   */
  className?: string;
};

function BellIcon({ off = false }: { off?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function PushPermission({ bindingKey, className = "" }: Props) {
  const [view, setView] = useState<View>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const publicKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let config: Awaited<ReturnType<typeof getWebPushConfigAction>>;
      try {
        config = await getWebPushConfigAction();
      } catch {
        return;
      }
      if (cancelled || !config.enabled) return;
      // Read after mount (not during render) so server and client markup match.
      setDismissed(readStorage(PUSH_PROMPT_DISMISSED_KEY) !== null);
      publicKeyRef.current = config.publicKey;

      const registration = await getRegistration();
      if (cancelled) return;
      const state = decidePushUi({
        standalone: readStandalone(),
        hasPushManager: "PushManager" in window,
        hasServiceWorker: registration !== undefined,
        permission: readPermission(),
        configEnabled: true,
        isIos: isIosSafari({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
        }),
      });

      if (state === "denied") {
        // Show the "blocked" hint only once per device; afterwards stay quiet.
        if (readStorage(PUSH_DENIED_HINT_SHOWN_KEY) !== null) return;
        writeStorage(PUSH_DENIED_HINT_SHOWN_KEY, "1");
        setView({ kind: "denied" });
        return;
      }
      if (state === "hidden" || state === "install-hint") {
        setView({ kind: state });
        return;
      }
      if (state === "prompt" || !registration) {
        setView({ kind: "off" });
        return;
      }

      // Permission already granted: keep the server binding fresh on every open
      // (iOS has no pushsubscriptionchange event).
      try {
        let subscription = await registration.pushManager.getSubscription();
        const action = decidePushSync({
          hasSubscription: subscription !== null,
          storedMarker: readStorage(PUSH_BINDING_MARKER_KEY),
          currentKey: bindingKey,
          optedOut: readStorage(PUSH_OPT_OUT_KEY) === bindingKey,
        });

        if (action === "skip" || action === "release") {
          if (action === "release" && subscription) {
            await unsubscribeWebPushAction({ endpoint: subscription.endpoint }).catch(() => undefined);
            await subscription.unsubscribe();
            writeStorage(PUSH_BINDING_MARKER_KEY, null);
          }
          if (!cancelled) setView({ kind: "off" });
          return;
        }

        if (action === "rebind" && subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
        if (!subscription) subscription = await subscribeBrowser(registration, config.publicKey);

        const input = toSubscribeInput(subscription.toJSON(), navigator.userAgent);
        if (!input) throw new Error("incomplete subscription");
        const result = await subscribeWebPushAction(input);
        if (cancelled) return;
        if (result.status === "subscribed") {
          writeStorage(PUSH_BINDING_MARKER_KEY, bindingKey);
          setView({ kind: "on" });
          return;
        }
        const message = subscribeFailureMessage(result.status);
        setView(message === null ? { kind: "hidden" } : { kind: "off", message });
      } catch {
        if (!cancelled) setView({ kind: "off" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bindingKey]);

  async function enable() {
    const publicKey = publicKeyRef.current;
    if (!publicKey || busy) return;
    setBusy(true);
    let subscription: PushSubscription | null = null;
    try {
      // Permission and subscription are requested only from this tap.
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        writeStorage(PUSH_DENIED_HINT_SHOWN_KEY, "1");
        setView({ kind: "denied" });
        return;
      }
      if (permission !== "granted") {
        setView({ kind: "off", message: "Bildirim izni verilmedi." });
        return;
      }
      const registration = await getRegistration();
      if (!registration) throw new Error("no service worker");
      subscription = await registration.pushManager.getSubscription();
      if (subscription && readStorage(PUSH_BINDING_MARKER_KEY) !== bindingKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await subscribeBrowser(registration, publicKey);
      const input = toSubscribeInput(subscription.toJSON(), navigator.userAgent);
      if (!input) throw new Error("incomplete subscription");
      const result = await subscribeWebPushAction(input);
      if (result.status === "subscribed") {
        writeStorage(PUSH_OPT_OUT_KEY, null);
        writeStorage(PUSH_BINDING_MARKER_KEY, bindingKey);
        setView({ kind: "on", message: "Bildirimler açıldı." });
        return;
      }
      await subscription.unsubscribe().catch(() => false);
      const message = subscribeFailureMessage(result.status);
      setView(message === null ? { kind: "hidden" } : { kind: "off", message });
    } catch {
      setView({ kind: "off", message: "Bildirimler açılamadı. Tekrar deneyin." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await unsubscribeWebPushAction({ endpoint: subscription.endpoint });
        if (result.status === "UNAUTHORIZED") {
          setView({ kind: "on", message: "Oturumunuz sona ermiş. Yeniden giriş yapın." });
          return;
        }
        await subscription.unsubscribe();
      }
      writeStorage(PUSH_BINDING_MARKER_KEY, null);
      writeStorage(PUSH_OPT_OUT_KEY, bindingKey);
      // The user chose "off": keep the quiet bell instead of re-showing the banner.
      writeStorage(PUSH_PROMPT_DISMISSED_KEY, "1");
      setDismissed(true);
      setView({ kind: "off", message: "Bildirimler kapatıldı." });
    } catch {
      setView({ kind: "on", message: "Bildirimler kapatılamadı. Tekrar deneyin." });
    } finally {
      setBusy(false);
    }
  }

  function later() {
    writeStorage(PUSH_PROMPT_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  if (view.kind === "hidden") return null;

  // On, or off after "Daha sonra": a compact bell toggle instead of a persistent card.
  if (view.kind === "on" || (view.kind === "off" && dismissed)) {
    const on = view.kind === "on";
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={on ? disable : enable}
          disabled={busy}
          aria-busy={busy}
          aria-label={on ? "Bildirimler açık. Kapatmak için dokunun." : "Bildirimler kapalı. Açmak için dokunun."}
          className={`pressable focus-ring tap-target inline-flex items-center gap-1.5 rounded-full border px-3 text-footnote font-semibold disabled:cursor-wait disabled:opacity-60 ${
            on ? "border-separator bg-surface text-ink hover:bg-surface-muted" : "border-separator bg-surface text-ink-muted hover:bg-surface-muted"
          }`}
        >
          <BellIcon off={!on} />
          <span>{busy ? (on ? "Kapatılıyor…" : "Açılıyor…") : on ? "Açık" : "Kapalı"}</span>
        </button>
        {view.message && (
          <p role="status" className="max-w-48 text-right text-caption text-ink-muted">
            {view.message}
          </p>
        )}
      </div>
    );
  }

  // Remaining views are a single-line banner; install hint can be postponed too.
  if (view.kind === "install-hint" && dismissed) return null;

  return (
    <section
      aria-label="Bildirimler"
      className={`flex basis-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-separator bg-surface px-3.5 py-2 text-subhead text-ink ${className}`}
    >
      <BellIcon off={view.kind === "denied"} />
      {view.kind === "install-hint" && (
        <p className="min-w-0 flex-1 leading-snug">
          Bildirim için ana ekrana ekleyin:{" "}
          <span className="text-ink-muted">
            Paylaş <span aria-hidden="true">(⬆︎)</span> → Ana Ekrana Ekle
          </span>
        </p>
      )}

      {view.kind === "denied" && (
        <p className="min-w-0 flex-1 leading-snug text-ink-muted">
          Bildirimler engellendi. Cihaz ayarlarından izin verebilirsiniz.
        </p>
      )}

      {view.kind === "off" && (
        <p className="min-w-0 flex-1 leading-snug">
          Yeni talepler için bildirim alın.
          {view.message && (
            <span role="status" className="block text-footnote text-ink-muted">
              {view.message}
            </span>
          )}
        </p>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {view.kind === "off" && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            aria-busy={busy}
            className="pressable focus-ring tap-target inline-flex items-center rounded-control bg-action px-3 text-subhead font-semibold text-on-action hover:bg-action-hover disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Açılıyor…" : "Bildirimleri aç"}
          </button>
        )}
        {(view.kind === "off" || view.kind === "install-hint") && (
          <button
            type="button"
            onClick={later}
            disabled={busy}
            className="focus-ring tap-target inline-flex items-center rounded-control px-3 text-subhead font-medium text-ink-muted hover:bg-surface-muted"
          >
            Daha sonra
          </button>
        )}
      </div>
    </section>
  );
}
