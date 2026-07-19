/* Explorateur de films — service worker (offline app shell + CSV cache).
   Bump VERSION and the cache-busting query strings together with
   index.html/style.css/script.js on every deploy, or clients can be served a
   stale shell from the cache. */
const CACHE_PREFIX = "mlx-";
const VERSION = "mlx-8.8.12";
const SHELL = VERSION + "-shell";
// The CSV cache is intentionally version-independent (like POSTERS): the last
// known-good dataset must survive an app upgrade so a freshly updated client is
// still offline-capable if Google Sheets is unreachable during the reload.
const DATA = CACHE_PREFIX + "data";
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
  "./style.css?v=8.8.12",
  "./script.js?v=8.8.12",
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
  "./favicon.svg?v=8.8.12",
  "./favicon-16.png?v=8.8.12",
  "./favicon-32.png?v=8.8.12",
  "./apple-touch-icon.png?v=8.8.12",
  "./icon-192.png?v=8.8.12",
  "./icon-512.png?v=8.8.12",
  "./icon-maskable-512.png?v=8.8.12"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

// Copy any previous versioned data cache (`mlx-<version>-data`) into the stable
// `mlx-data` cache, then drop it. Earlier releases stored the CSV under a versioned
// name; without this migration, switching to a version-independent cache would strand
// (and eventually delete) the last known-good dataset on the very upgrade that is
// supposed to preserve it — leaving a client that updates while Google Sheets is down
// with no offline fallback. Existing `mlx-data` entries are never overwritten.
async function migrateLegacyDataCaches(keys) {
  const legacy = keys.filter(key => key.startsWith(CACHE_PREFIX) && key.endsWith("-data") && key !== DATA);
  if (!legacy.length) return;
  const dataCache = await caches.open(DATA);
  for (const name of legacy) {
    const oldCache = await caches.open(name);
    for (const request of await oldCache.keys()) {
      if (await dataCache.match(request)) continue;
      const response = await oldCache.match(request);
      if (response) await dataCache.put(request, response);
    }
    await caches.delete(name);
  }
}

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await migrateLegacyDataCaches(keys);
    // Only purge this app's own old caches: CacheStorage is origin-wide, so a
    // bare "not current version" filter would wipe other apps on a shared origin.
    // Keep POSTERS and DATA (version-independent); legacy `-data` caches are handled
    // by the migration above.
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== POSTERS && key !== DATA && !key.endsWith("-data") && !key.startsWith(VERSION))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// A response is only a valid CSV replacement when it is 2xx and not an HTML page.
// Google can answer a published-sheet request with a status-200 login, quota, or
// error page (content-type text/html); caching that would poison offline recovery.
function looksLikeCsv(response) {
  if (!response || !response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  return !type.includes("html");
}

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
  if (url.origin !== self.location.origin && (url.protocol === "https:" || url.protocol === "http:") && request.destination === "image") {
    event.respondWith(
      caches.open(POSTERS).then(async cache => {
        const cached = await cache.match(request);
        const fetchAndCache = fetch(request).then(async response => {
          // Opaque (no-CORS) responses report ok=false but are still valid images.
          if (response && (response.ok || response.type === "opaque")) {
            // Fail open: a cache.put quota rejection (or trim failure) must never turn
            // a valid poster response into a broken image.
            try {
              await cache.put(request, response.clone());
              await trimCache(cache, POSTER_CACHE_LIMIT);
            } catch {}
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
            if (looksLikeCsv(response)) {
              // Await the write (tied to the event via respondWith) so the SW isn't
              // killed before the new CSV is persisted.
              await cache.put(request, response.clone()).catch(() => {});
              return response;
            }
            // A non-2xx (429/5xx) or HTML error page is not a usable replacement:
            // hand back the last good CSV if we have one, else surface the response.
            const cached = await cache.match(request);
            return cached || response;
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
        const network = fetch(request).then(async response => {
          // Only replace the cache with a valid CSV; a non-2xx or HTML page must
          // not overwrite the last good dataset.
          if (!looksLikeCsv(response)) return cached || response;
          await cache.put(request, response.clone()).catch(() => {});
          return response;
        }).catch(() => cached);
        // Keep the revalidation + write alive even when we serve the cached copy.
        event.waitUntil(network.catch(() => {}));
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
