import { describe, expect, it } from "vitest";
import {
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  shouldRegisterServiceWorker,
} from "./sw-registration";

const supportedNavigator = { serviceWorker: {} };

describe("shouldRegisterServiceWorker", () => {
  it("registers in production with serviceWorker support and a secure context", () => {
    expect(
      shouldRegisterServiceWorker({
        nodeEnv: "production",
        navigator: supportedNavigator,
        isSecureContext: true,
      }),
    ).toBe(true);
  });

  it.each(["development", "test", undefined, ""])(
    "does not register when NODE_ENV is %s",
    (nodeEnv) => {
      expect(
        shouldRegisterServiceWorker({
          nodeEnv,
          navigator: supportedNavigator,
          isSecureContext: true,
        }),
      ).toBe(false);
    },
  );

  it("does not register when navigator lacks serviceWorker", () => {
    expect(
      shouldRegisterServiceWorker({
        nodeEnv: "production",
        navigator: {},
        isSecureContext: true,
      }),
    ).toBe(false);
  });

  it("does not register when navigator is unavailable", () => {
    expect(
      shouldRegisterServiceWorker({
        nodeEnv: "production",
        navigator: undefined,
        isSecureContext: true,
      }),
    ).toBe(false);
  });

  it.each([false, undefined])("does not register when isSecureContext is %s", (isSecureContext) => {
    expect(
      shouldRegisterServiceWorker({
        nodeEnv: "production",
        navigator: supportedNavigator,
        isSecureContext,
      }),
    ).toBe(false);
  });

  it("targets /sw.js with root scope", () => {
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
    expect(SERVICE_WORKER_SCOPE).toBe("/");
  });
});
