import { describe, expect, it } from "vitest";
import {
  INSTALL_PROMPT_DISMISSED_KEY,
  INSTALL_PROMPT_DISMISSED_VALUE,
  isInstallPromptDismissed,
  isIosSafari,
  isStandalone,
  shouldShowInstallPrompt,
} from "./install-prompt-state";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.0.2535.87 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone14,5; iOS 17_5; tr_TR; tr; scale=3.00; 1170x2532; 614245345)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.43.105;FBBV/615394412;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBLC/tr_TR;FBOP/5]",
  iphoneFacebookWithSafariTokens:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/470.0.0.43.105]",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};

describe("isStandalone", () => {
  it("is true when display-mode standalone matches", () => {
    expect(isStandalone({ displayModeStandalone: true, navigatorStandalone: undefined })).toBe(true);
  });

  it("is true when iOS navigator.standalone is true", () => {
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
  });

  it("is false when neither signal is true", () => {
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
    expect(
      isStandalone({ displayModeStandalone: undefined, navigatorStandalone: undefined }),
    ).toBe(false);
  });
});

describe("isIosSafari", () => {
  it("detects iPhone Safari", () => {
    expect(
      isIosSafari({ userAgent: UA.iphoneSafari, platform: "iPhone", maxTouchPoints: 5 }),
    ).toBe(true);
  });

  it.each([
    ["Chrome (CriOS)", UA.iphoneChrome],
    ["Firefox (FxiOS)", UA.iphoneFirefox],
    ["Edge (EdgiOS)", UA.iphoneEdge],
    ["Instagram in-app", UA.iphoneInstagram],
    ["Facebook in-app (FBAN)", UA.iphoneFacebook],
    ["Facebook in-app with Safari tokens", UA.iphoneFacebookWithSafariTokens],
  ])("rejects iOS %s", (_label, userAgent) => {
    expect(isIosSafari({ userAgent, platform: "iPhone", maxTouchPoints: 5 })).toBe(false);
  });

  it("rejects Android Chrome", () => {
    expect(
      isIosSafari({ userAgent: UA.androidChrome, platform: "Linux armv8l", maxTouchPoints: 5 }),
    ).toBe(false);
  });

  it("rejects desktop Mac Safari (no touch)", () => {
    expect(
      isIosSafari({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isIosSafari({ userAgent: UA.macSafari })).toBe(false);
  });

  it("detects iPadOS Safari reporting a desktop UA (MacIntel + touch)", () => {
    expect(
      isIosSafari({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe(true);
  });

  it("rejects an empty user agent", () => {
    expect(isIosSafari({ userAgent: "" })).toBe(false);
  });
});

describe("isInstallPromptDismissed", () => {
  it("uses a namespaced localStorage key", () => {
    expect(INSTALL_PROMPT_DISMISSED_KEY).toBe("salon-saas:pwa-install-dismissed");
  });

  it("is true only for the stored dismissal value", () => {
    expect(isInstallPromptDismissed(INSTALL_PROMPT_DISMISSED_VALUE)).toBe(true);
  });

  it.each([null, undefined, "", "0", "true"])("is false for %s", (value) => {
    expect(isInstallPromptDismissed(value)).toBe(false);
  });
});

describe("shouldShowInstallPrompt", () => {
  const base = { standalone: false, dismissed: false, hasDeferredPrompt: false, iosSafari: false };

  it("returns null when standalone, even with a deferred prompt or iOS Safari", () => {
    expect(
      shouldShowInstallPrompt({ ...base, standalone: true, hasDeferredPrompt: true }),
    ).toBeNull();
    expect(shouldShowInstallPrompt({ ...base, standalone: true, iosSafari: true })).toBeNull();
  });

  it("returns null when dismissed, even with a deferred prompt or iOS Safari", () => {
    expect(
      shouldShowInstallPrompt({ ...base, dismissed: true, hasDeferredPrompt: true }),
    ).toBeNull();
    expect(shouldShowInstallPrompt({ ...base, dismissed: true, iosSafari: true })).toBeNull();
  });

  it('returns "native" when a deferred beforeinstallprompt exists', () => {
    expect(shouldShowInstallPrompt({ ...base, hasDeferredPrompt: true })).toBe("native");
  });

  it('prefers "native" over the iOS hint when both apply', () => {
    expect(
      shouldShowInstallPrompt({ ...base, hasDeferredPrompt: true, iosSafari: true }),
    ).toBe("native");
  });

  it('returns "ios-hint" on iOS Safari without a deferred prompt', () => {
    expect(shouldShowInstallPrompt({ ...base, iosSafari: true })).toBe("ios-hint");
  });

  it("returns null when unsupported (no deferred prompt, not iOS Safari)", () => {
    expect(shouldShowInstallPrompt(base)).toBeNull();
  });
});
