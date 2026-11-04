/**
 * Pure decision logic for the PWA install prompt (WP-3).
 *
 * Install/dismiss state is UI-only. It is never used for authorization,
 * tenant context or appointment lifecycle decisions.
 */

export const INSTALL_PROMPT_DISMISSED_KEY = "salon-saas:pwa-install-dismissed";
export const INSTALL_PROMPT_DISMISSED_VALUE = "1";

export type StandaloneSignals = {
  /** Result of matchMedia("(display-mode: standalone)").matches. */
  displayModeStandalone: boolean | undefined;
  /** iOS Safari's non-standard navigator.standalone. */
  navigatorStandalone: boolean | undefined;
};

export function isStandalone(signals: StandaloneSignals): boolean {
  return signals.displayModeStandalone === true || signals.navigatorStandalone === true;
}

export type IosSafariSignals = {
  userAgent: string;
  /** navigator.platform, used to detect iPadOS that reports a desktop UA. */
  platform?: string | undefined;
  /** navigator.maxTouchPoints. */
  maxTouchPoints?: number | undefined;
};

// Other browsers / in-app web views on iOS that cannot "Add to Home Screen" via Safari's share sheet.
const NON_SAFARI_IOS_TOKENS = [
  "CriOS", // Chrome
  "FxiOS", // Firefox
  "EdgiOS", // Edge
  "OPiOS", // Opera
  "OPT/", // Opera Touch
  "YaBrowser", // Yandex
  "DuckDuckGo",
  "GSA/", // Google app
  "FBAN", // Facebook
  "FBAV",
  "Instagram",
  "Line/",
  "Twitter",
  "WhatsApp",
  "TikTok",
  "musical_ly",
  "Snapchat",
  "Pinterest",
  "LinkedInApp",
];

export function isIosSafari(signals: IosSafariSignals): boolean {
  const ua = signals.userAgent ?? "";

  const isIosDevice = /iPhone|iPad|iPod/.test(ua);
  const isIpadOsDesktopUa =
    !isIosDevice &&
    /Macintosh/.test(ua) &&
    signals.platform === "MacIntel" &&
    typeof signals.maxTouchPoints === "number" &&
    signals.maxTouchPoints > 1;

  if (!isIosDevice && !isIpadOsDesktopUa) return false;

  // Real Safari includes both "Safari/" and "Version/"; most WKWebView in-app browsers omit them.
  if (!/Safari\//.test(ua) || !/Version\//.test(ua)) return false;

  return !NON_SAFARI_IOS_TOKENS.some((token) => ua.includes(token));
}

export function isInstallPromptDismissed(storedValue: string | null | undefined): boolean {
  return storedValue === INSTALL_PROMPT_DISMISSED_VALUE;
}

export type InstallPromptVariant = "native" | "ios-hint";

export type InstallPromptInputs = {
  standalone: boolean;
  dismissed: boolean;
  /** A beforeinstallprompt event has been captured and not yet used. */
  hasDeferredPrompt: boolean;
  iosSafari: boolean;
};

/** Returns which prompt to show, or null when nothing should be shown. */
export function shouldShowInstallPrompt(inputs: InstallPromptInputs): InstallPromptVariant | null {
  if (inputs.standalone || inputs.dismissed) return null;
  if (inputs.hasDeferredPrompt) return "native";
  if (inputs.iosSafari) return "ios-hint";
  return null;
}
