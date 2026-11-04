"use client";

import { useEffect } from "react";
import {
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  shouldRegisterServiceWorker,
} from "./sw-registration";

/** Registers the static-asset-only service worker in production builds. Renders nothing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      !shouldRegisterServiceWorker({
        nodeEnv: process.env.NODE_ENV,
        navigator: typeof navigator === "undefined" ? undefined : navigator,
        isSecureContext: typeof window === "undefined" ? undefined : window.isSecureContext,
      })
    ) {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE })
        .catch(() => {
          // Registration failure must not affect the app; the site works without a service worker.
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
