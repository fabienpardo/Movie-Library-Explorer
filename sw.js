/* Explorateur de films — service worker (offline app shell + CSV cache).
   Bump VERSION and the cache-busting query strings together with
   index.html/style.css/script.js on every deploy, or clients can be served a
   stale shell from the cache. */
const CACHE_PREFIX = "mlx-";
const VERSION = "mlx-8.8.8";
const SHELL = VERSION + "-shell";
const DATA = VERSION + "-data";
// Poster images are immutable per URL, so they live in a version-independent cache
// that survives app deploys (no point re-downloading them on every version bump).
const POSTERS = CACHE_PREFIX + "posters";
const POSTER_CACHE_LIMIT = 600;

// Core app shell. Query strings must match how index.html references each asset so the
// precache keys line up with the runtime requests the browser makes.
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./style.css?v=8.8.8",
  "./script.js?v=8.8.8",
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
  "./src/utils.mjs",
  "./favicon-32.png?v=8.8.8",
  "./apple-touch-icon.png?v=8.8.8",
  "./icon-192.png?v=8.8.8",
  "./icon-512.png?v=8.8.8",
  "./icon-maskable-512.png?v=8.8.8"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      // Only purge this app's own old caches: CacheStorage is origin-wide, so a
      // bare "not current version" filter would wipe other apps on a shared origin.
      // Keep POSTERS: it is intentionally version-independent.
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== POSTERS && !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// FIFO-trim a cache down to `limit` entries. Cache.keys() preserves insertion
// order, so the oldest-stored posters are evicted first.
async function trimCache(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Cross-origin poster images (URLs come straight from the sheet) -> cache-first,
  // refresh in the background, capped so the store can't grow without bound. This is
  // the only persistence posters get: same-origin/SW logic below never sees them.
  if (url.origin !== self.location.origin && request.destination === "image") {
    event.respondWith(
      caches.open(POSTERS).then(async cache => {
        const cached = await cache.match(request);
        const fetchAndCache = fetch(request).then(async response => {
          // Opaque (no-CORS) responses report ok=false but are still valid images.
          if (response && (response.ok || response.type === "opaque")) {
            await cache.put(request, response.clone());
            await trimCache(cache, POSTER_CACHE_LIMIT);
          }
          return response;
        });
        // Tie the network+write to the event lifetime so the SW isn't killed
        // before mlx-posters is populated, even when we hand back the cached hit.
        // Registered here while respondWith still holds the event active.
        event.waitUntil(fetchAndCache.catch(() => {}));
        return cached || fetchAndCache;
      })
    );
    return;
  }

  // Published Google Sheet CSV.
  if (url.hostname.endsWith("docs.google.com")) {
    // The app fetches the CSV with cache:"no-store" (incl. "Recharger les données"),
    // which signals it wants fresh data -> network-first: return the live sheet and
    // refresh the cache, falling back to the cached copy only when offline. Without
    // this, stale-while-revalidate would hand back the old CSV and the manual reload
    // would show stale data until a second reload.
    if (request.cache === "no-store" || request.cache === "reload") {
      event.respondWith(
        caches.open(DATA).then(async cache => {
          try {
            const response = await fetch(request);
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          } catch (error) {
            const cached = await cache.match(request);
            if (cached) return cached;
            throw error;
          }
        })
      );
      return;
    }

    // Any other consumer -> stale-while-revalidate: serve the last copy instantly,
    // refresh in the background, and keep working offline once it has been seen.
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
