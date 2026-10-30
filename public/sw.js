/// <reference lib="webworker" />

const CACHE_NAME = "salon-saas-pwa-v1";

const LEGACY_CACHE_NAMES = ["salon-saas-v1"];

const ALLOWED_STATIC_PATHS = new Set([
  "/manifest.json",
  "/icons/app-icon.svg",
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
