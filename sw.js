/* Explorateur de films — service worker (offline app shell + CSV cache).
   Bump VERSION and the cache-busting query strings together with
   index.html/style.css/script.js on every deploy, or clients can be served a
   stale shell from the cache. */
const VERSION = "mlx-8.8.2";
const SHELL = VERSION + "-shell";
const DATA = VERSION + "-data";

// Core app shell. Query strings must match how index.html references each asset so the
// precache keys line up with the runtime requests the browser makes.
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./style.css?v=8.8.2",
  "./script.js?v=8.8.2",
  "./src/app.mjs",
  "./src/config.mjs",
  "./src/data.mjs",
  "./src/dom.mjs",
  "./src/filter-panel.mjs",
  "./src/matching.mjs",
  "./src/render-cards.mjs",
  "./src/render-filters.mjs",
  "./src/selection.mjs",
  "./src/sorting.mjs",
  "./src/state.mjs",
  "./src/test-hooks.mjs",
  "./src/utils.mjs",
  "./favicon.svg",
  "./favicon-16.png",
  "./favicon-32.png?v=8.8.2",
  "./apple-touch-icon.png?v=8.8.2",
  "./icon-192.png?v=8.8.2",
  "./icon-512.png?v=8.8.2",
  "./icon-maskable-512.png?v=8.8.2"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Published Google Sheet CSV -> stale-while-revalidate: serve the last copy instantly,
  // refresh in the background, and keep working offline once it has been seen.
  if (url.hostname.endsWith("docs.google.com")) {
    event.respondWith(
      caches.open(DATA).then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request).then(response => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin navigations -> fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  // Other same-origin assets -> cache-first, refreshing the cache in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (response && response.ok) caches.open(SHELL).then(cache => cache.put(request, response.clone()));
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
