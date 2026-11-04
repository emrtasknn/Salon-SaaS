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

type Props = {
  /** Opaque, non-authoritative key of the signed-in tenant/profile (server-hashed). */
  bindingKey: string;
  className?: string;
  widthClassName?: string;
};

const buttonClass =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-60";

export function PushPermission({ bindingKey, className, widthClassName = "max-w-6xl" }: Props) {
  const [view, setView] = useState<View>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);
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

      if (state === "hidden" || state === "install-hint" || state === "denied") {
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
      setView({ kind: "off", message: "Bildirimler kapatıldı." });
    } catch {
      setView({ kind: "on", message: "Bildirimler kapatılamadı. Tekrar deneyin." });
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "hidden") return null;

  return (
    <div className={className}>
      <section
        aria-label="Bildirimler"
        className={`mx-auto flex ${widthClassName} flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900`}
      >
        {view.kind === "install-hint" && (
          <p className="min-w-0 flex-1 leading-snug">
            <span className="font-medium">Bildirim almak için ana ekrana ekleyin:</span>{" "}
            <span className="text-zinc-700">
              Paylaş <span aria-hidden="true">(⬆︎)</span> → Ana Ekrana Ekle
            </span>
          </p>
        )}

        {view.kind === "denied" && (
          <p className="min-w-0 flex-1 leading-snug">
            <span className="font-medium">Bildirimler engellendi.</span>{" "}
            <span className="text-zinc-700">
              Açmak için cihaz ayarlarından bu uygulamanın bildirim iznini verin.
            </span>
          </p>
        )}

        {view.kind === "off" && (
          <>
            <p className="min-w-0 flex-1 leading-snug">
              <span className="font-medium">Yeni randevu talepleri için bildirim alın.</span>
              {view.message && (
                <span role="status" className="block text-zinc-700">
                  {view.message}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              aria-busy={busy}
              className={`${buttonClass} bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-800`}
            >
              {busy ? "Açılıyor…" : "Bildirimleri aç"}
            </button>
          </>
        )}

        {view.kind === "on" && (
          <>
            <p role="status" className="min-w-0 flex-1 leading-snug">
              <span className="font-medium">Bildirimler açık</span>
              {view.message && <span className="block text-zinc-700">{view.message}</span>}
            </p>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              aria-busy={busy}
              aria-label="Bildirimleri kapat"
              className={`${buttonClass} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100`}
            >
              {busy ? "Kapatılıyor…" : "Kapat"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
