import { describe, expect, it } from "vitest";
import {
  base64UrlToUint8Array,
  decidePushSync,
  decidePushUi,
  isMarkerMatch,
  subscribeFailureMessage,
  toSubscribeInput,
  type PushUiInputs,
} from "./push-state";

const ready: PushUiInputs = {
  standalone: true,
  hasPushManager: true,
  hasServiceWorker: true,
  permission: "default",
  configEnabled: true,
  isIos: false,
};

describe("decidePushUi", () => {
  it("offers the button in an installed app with default permission", () => {
    expect(decidePushUi(ready)).toBe("prompt");
  });

  it("renders nothing when the server is not configured, even on iOS non-standalone", () => {
    expect(decidePushUi({ ...ready, configEnabled: false })).toBe("hidden");
    expect(decidePushUi({ ...ready, configEnabled: false, standalone: false, isIos: true })).toBe("hidden");
  });

  it("shows the install hint on iOS Safari when not installed", () => {
    expect(
      decidePushUi({ ...ready, standalone: false, isIos: true, hasPushManager: false }),
    ).toBe("install-hint");
  });

  it("hides on non-iOS browsers when not installed", () => {
    expect(decidePushUi({ ...ready, standalone: false })).toBe("hidden");
  });

  it("hides when PushManager or service worker is missing", () => {
    expect(decidePushUi({ ...ready, hasPushManager: false })).toBe("hidden");
    expect(decidePushUi({ ...ready, hasServiceWorker: false })).toBe("hidden");
    expect(decidePushUi({ ...ready, permission: undefined })).toBe("hidden");
  });

  it("maps denied and granted permission", () => {
    expect(decidePushUi({ ...ready, permission: "denied" })).toBe("denied");
    expect(decidePushUi({ ...ready, permission: "granted" })).toBe("granted");
  });
});

describe("isMarkerMatch", () => {
  it("matches only identical non-empty keys", () => {
    expect(isMarkerMatch("k1", "k1")).toBe(true);
    expect(isMarkerMatch("k1", "k2")).toBe(false);
    expect(isMarkerMatch(null, "k1")).toBe(false);
    expect(isMarkerMatch(undefined, "k1")).toBe(false);
    expect(isMarkerMatch("", "")).toBe(false);
  });
});

describe("decidePushSync", () => {
  const base = { currentKey: "k1", storedMarker: "k1", optedOut: false };
  it("subscribes when the browser has no subscription", () => {
    expect(decidePushSync({ ...base, hasSubscription: false })).toBe("subscribe");
  });
  it("re-binds the same subscription for the same key", () => {
    expect(decidePushSync({ ...base, hasSubscription: true })).toBe("bind");
  });
  it("rebinds with a fresh endpoint on mismatch or missing marker", () => {
    expect(decidePushSync({ ...base, storedMarker: "other", hasSubscription: true })).toBe("rebind");
    expect(decidePushSync({ ...base, storedMarker: null, hasSubscription: true })).toBe("rebind");
  });
  it("respects in-app opt-out", () => {
    expect(decidePushSync({ ...base, optedOut: true, hasSubscription: false })).toBe("skip");
    expect(decidePushSync({ ...base, optedOut: true, hasSubscription: true })).toBe("release");
  });
});

describe("base64UrlToUint8Array", () => {
  it("decodes unpadded base64url", () => {
    // "\xfb\xff\xbf" → base64 "+/+/" → base64url "-_-_"
    expect(Array.from(base64UrlToUint8Array("-_-_"))).toEqual([0xfb, 0xff, 0xbf]);
    expect(Array.from(base64UrlToUint8Array("AQI"))).toEqual([1, 2]);
    expect(Array.from(base64UrlToUint8Array("AQI="))).toEqual([1, 2]);
  });

  it("decodes a 65-byte uncompressed P-256 VAPID key", () => {
    const key = "B" + "A".repeat(86);
    const bytes = base64UrlToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("rejects non-base64url input", () => {
    expect(() => base64UrlToUint8Array("ab+c")).toThrow();
    expect(() => base64UrlToUint8Array("a b")).toThrow();
    expect(() => base64UrlToUint8Array("A")).toThrow();
  });
});

describe("toSubscribeInput", () => {
  const json = {
    endpoint: "https://push.example.test/abc",
    keys: { p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) },
  };

  it("maps a complete subscription", () => {
    expect(toSubscribeInput(json, "UA")).toEqual({ ...json, userAgent: "UA" });
    expect(toSubscribeInput(json)).toEqual(json);
  });

  it("truncates the user agent to 256 characters", () => {
    expect(toSubscribeInput(json, "u".repeat(300))?.userAgent).toHaveLength(256);
  });

  it("rejects incomplete or non-https subscriptions", () => {
    expect(toSubscribeInput(null)).toBeNull();
    expect(toSubscribeInput({ ...json, endpoint: "http://push.example.test" })).toBeNull();
    expect(toSubscribeInput({ endpoint: json.endpoint, keys: { p256dh: "x" } })).toBeNull();
    expect(toSubscribeInput({ endpoint: json.endpoint })).toBeNull();
  });
});

describe("subscribeFailureMessage", () => {
  it("returns copy for user-facing failures and hides when not configured", () => {
    expect(subscribeFailureMessage("UNAUTHORIZED")).toMatch(/giriş/);
    expect(subscribeFailureMessage("FORBIDDEN")).toBeTruthy();
    expect(subscribeFailureMessage("INVALID")).toBeTruthy();
    expect(subscribeFailureMessage("NOT_CONFIGURED")).toBeNull();
  });
});
