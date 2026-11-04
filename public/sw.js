/// <reference lib="webworker" />

const CACHE_NAME = "salon-saas-pwa-v2";

const LEGACY_CACHE_NAMES = ["salon-saas-v1", "salon-saas-pwa-v1"];

const PNG_ICON_PATHS = new Set([
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
]);

const ALLOWED_STATIC_PATHS = new Set([
  "/manifest.json",
  "/icons/app-icon.svg",
  ...PNG_ICON_PATHS,
]);

function hasExpectedContentType(path, response) {
  const contentType = (
    response.headers.get("content-type") || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (path === "/manifest.json") {
    return (
      contentType === "application/manifest+json" ||
      contentType === "application/json"
    );
  }

  if (path === "/icons/app-icon.svg") {
    return contentType === "image/svg+xml";
  }

  if (PNG_ICON_PATHS.has(path)) {
    return contentType === "image/png";
  }

  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);

        for (const path of ALLOWED_STATIC_PATHS) {
          try {
            const response = await fetch(path, { cache: "reload" });

            if (
              response.ok &&
              response.type !== "opaque" &&
              hasExpectedContentType(path, response)
            ) {
              await cache.put(path, response);
            }
          } catch {
            // Installation continues if a static asset is unavailable.
          }
        }
      } catch {
        // Service worker installation must not depend on Cache Storage.
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all(
      LEGACY_CACHE_NAMES
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const isAllowedStatic =
    ALLOWED_STATIC_PATHS.has(url.pathname) &&
    url.search === "" &&
    request.mode !== "navigate" &&
    !(request.headers.get("accept") || "").includes("text/html");

  if (!isAllowedStatic) return;

  event.respondWith(
    (async () => {
      let cachedResponse;

      try {
        const cache = await caches.open(CACHE_NAME);
        cachedResponse = await cache.match(request.url);
      } catch {
        // Continue with the network if Cache Storage is unavailable.
      }

      try {
        const networkResponse = await fetch(request);

        if (
          networkResponse.ok &&
          networkResponse.type !== "opaque" &&
          hasExpectedContentType(url.pathname, networkResponse)
        ) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request.url, networkResponse.clone());
          } catch {
            // Cache write failure must not break the network response.
          }
        }

        return networkResponse;
      } catch {
        if (cachedResponse) return cachedResponse;

        return new Response("Static resource unavailable", {
          status: 504,
          statusText: "Gateway Timeout",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }
    })(),
  );
});

// WP-09 Web Push. Display-only: the payload never drives auth, tenant or appointment state.

const PUSH_ICON_PATH = "/icons/icon-192.png";
const PUSH_FALLBACK_TITLE = "Yeni bildirim";
const PUSH_URL_ALLOWLIST = new Set(["/staff/appointments", "/admin/calendar"]);

function readPushPayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

function safeNotificationUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/";
    return PUSH_URL_ALLOWLIST.has(url.pathname) ? url.pathname : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title =
    payload && typeof payload.title === "string" && payload.title.trim()
      ? payload.title.slice(0, 120)
      : PUSH_FALLBACK_TITLE;
  const options = {
    icon: PUSH_ICON_PATH,
    data: { url: payload ? safeNotificationUrl(payload.url) : "/" },
  };
  if (payload && typeof payload.body === "string") options.body = payload.body.slice(0, 240);
  if (payload && typeof payload.tag === "string" && payload.tag) options.tag = payload.tag.slice(0, 100);

  // Always show a notification: iOS revokes subscriptions after silent pushes.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeNotificationUrl(
    event.notification.data && event.notification.data.url,
  );

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (existing) {
        try {
          const focused = await existing.focus();
          if (typeof focused.navigate === "function") await focused.navigate(target);
          return;
        } catch {
          // Fall through to opening a new window.
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
