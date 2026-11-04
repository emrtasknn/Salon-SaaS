/**
 * Pure decision logic for service worker registration (WP-3).
 *
 * The service worker is static-asset-only (see public/sw.js) and is never
 * authoritative for auth, tenant context or appointment state.
 */

export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

export type ServiceWorkerRegistrationEnvironment = {
  /** Value of process.env.NODE_ENV at build time. */
  nodeEnv: string | undefined;
  /** Navigator-like object; only the presence of `serviceWorker` is checked. */
  navigator: object | undefined;
  /** window.isSecureContext (HTTPS or localhost). */
  isSecureContext: boolean | undefined;
};

export function shouldRegisterServiceWorker(
  environment: ServiceWorkerRegistrationEnvironment,
): boolean {
  if (environment.nodeEnv !== "production") return false;
  if (environment.isSecureContext !== true) return false;
  if (typeof environment.navigator !== "object" || environment.navigator === null) {
    return false;
  }
  return "serviceWorker" in environment.navigator;
}
