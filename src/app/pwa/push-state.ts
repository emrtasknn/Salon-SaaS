/**
 * Pure decision logic for Web Push opt-in (WP-09).
 *
 * Everything here is UI-only. Browser permission, subscription state and the
 * localStorage binding marker are never authoritative: the server derives the
 * tenant/profile from the session in subscribeWebPushAction / unsubscribeWebPushAction.
 */

/** Last bound opaque key (tenant + subject hash from the server page). */
export const PUSH_BINDING_MARKER_KEY = "salon-saas:push-binding";
/** Set to the opaque key when the user turned notifications off in-app. */
export const PUSH_OPT_OUT_KEY = "salon-saas:push-opt-out";

export type PushPermission = "default" | "granted" | "denied";

export type PushUiInputs = {
  standalone: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  permission: PushPermission | undefined;
  configEnabled: boolean;
  /** iOS Safari (can install via Paylaş → Ana Ekrana Ekle). */
  isIos: boolean;
};

export type PushUiState = "hidden" | "install-hint" | "denied" | "prompt" | "granted";

/** Which push UI to show. Push is only offered inside the installed app. */
export function decidePushUi(inputs: PushUiInputs): PushUiState {
  if (!inputs.configEnabled) return "hidden";
  if (!inputs.standalone) return inputs.isIos ? "install-hint" : "hidden";
  if (!inputs.hasServiceWorker || !inputs.hasPushManager) return "hidden";
  if (inputs.permission === undefined) return "hidden";
  if (inputs.permission === "denied") return "denied";
  if (inputs.permission === "granted") return "granted";
  return "prompt";
}

export function isMarkerMatch(
  storedMarker: string | null | undefined,
  currentKey: string,
): boolean {
  return typeof storedMarker === "string" && storedMarker !== "" && storedMarker === currentKey;
}

export type PushSyncInputs = {
  hasSubscription: boolean;
  storedMarker: string | null | undefined;
  currentKey: string;
  optedOut: boolean;
};

/**
 * What to do on mount when permission is already "granted".
 * - skip: nothing to do (opted out, no browser subscription)
 * - release: opted out but a browser subscription exists → unsubscribe it
 * - subscribe: no browser subscription → create one and bind
 * - bind: subscription belongs to this key → re-send it (refresh/iOS)
 * - rebind: subscription bound to another (or unknown) key → unsubscribe, subscribe fresh
 */
export type PushSyncAction = "skip" | "release" | "subscribe" | "bind" | "rebind";

export function decidePushSync(inputs: PushSyncInputs): PushSyncAction {
  if (inputs.optedOut) return inputs.hasSubscription ? "release" : "skip";
  if (!inputs.hasSubscription) return "subscribe";
  return isMarkerMatch(inputs.storedMarker, inputs.currentKey) ? "bind" : "rebind";
}

/** Decodes a base64url VAPID public key into the bytes pushManager.subscribe expects. */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(trimmed)) {
    throw new Error("Invalid base64url value");
  }
  const unpadded = trimmed.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) throw new Error("Invalid base64url length");
  const base64 =
    unpadded.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (unpadded.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type WebPushSubscribeInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

/** Shapes PushSubscription.toJSON() into the server action input; null if incomplete. */
export function toSubscribeInput(
  json: { endpoint?: string | null; keys?: Record<string, string> | null } | null | undefined,
  userAgent?: string,
): WebPushSubscribeInput | null {
  const endpoint = json?.endpoint;
  const p256dh = json?.keys?.p256dh;
  const auth = json?.keys?.auth;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return null;
  if (typeof p256dh !== "string" || p256dh === "" || typeof auth !== "string" || auth === "") {
    return null;
  }
  const input: WebPushSubscribeInput = { endpoint, keys: { p256dh, auth } };
  if (typeof userAgent === "string" && userAgent !== "") input.userAgent = userAgent.slice(0, 256);
  return input;
}

export type SubscribeFailureStatus = "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | "NOT_CONFIGURED";

/** Short Turkish copy for a failed subscribe; null means "hide the UI". */
export function subscribeFailureMessage(status: SubscribeFailureStatus): string | null {
  switch (status) {
    case "UNAUTHORIZED":
      return "Oturumunuz sona ermiş. Yeniden giriş yapın.";
    case "FORBIDDEN":
      return "Bu hesap için bildirimler açılamıyor.";
    case "INVALID":
      return "Bildirimler açılamadı. Tekrar deneyin.";
    case "NOT_CONFIGURED":
      return null;
  }
}
