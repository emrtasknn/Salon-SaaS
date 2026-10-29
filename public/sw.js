/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

// Minimal PWA service worker — app shell caching + network-first fallback.
// Scope: tüm kararkteristik funzione URL'ler üzerine uygulandı.

const CACHE_NAME = "salon-saas-v1";
const APP_SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icons/app-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_URLS);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API ve webhook istekleri için cache'ten başka bekleme; sert zaten.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Statik varlıklar için cache-first
  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, networkResponse.clone());
          });
        }
        return networkResponse;
      });
    }),
  );
});
