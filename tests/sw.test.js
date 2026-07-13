#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createTestRegistry, runTests } = require("./helpers/test-runner");

const SW_PATH = path.resolve(__dirname, "..", "sw.js");
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=1&single=true&output=csv";
const POSTER_URL = "https://is1-ssl.mzstatic.com/image/thumb/abc/800x1200bb.jpg";
const ORIGIN = "https://example.github.io";

// ---- Minimal Service Worker environment mocks -----------------------------

class FakeHeaders {
  constructor(map = {}) {
    this.map = {};
    for (const key of Object.keys(map)) this.map[key.toLowerCase()] = map[key];
  }
  get(name) { return this.map[name.toLowerCase()] ?? null; }
}

let responseSeq = 0;
class FakeResponse {
  constructor({ status = 200, headers = {}, type = "basic", id } = {}) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.type = type;
    this.headers = headers instanceof FakeHeaders ? headers : new FakeHeaders(headers);
    this.id = id ?? `res-${(responseSeq += 1)}`;
  }
  clone() {
    return new FakeResponse({ status: this.status, headers: this.headers, type: this.type, id: this.id });
  }
}

const csvResponse = (id, status = 200) => new FakeResponse({ status, headers: { "content-type": "text/csv; charset=utf-8" }, id });
const htmlResponse = (id, status = 200) => new FakeResponse({ status, headers: { "content-type": "text/html; charset=utf-8" }, id });
const imageResponse = (id) => new FakeResponse({ status: 200, headers: { "content-type": "image/jpeg" }, id });

const keyOf = (req) => (typeof req === "string" ? req : req.url);

class FakeCache {
  constructor({ failPut = false } = {}) {
    this.store = new Map();
    this.failPut = failPut;
    this.putCalls = 0;
  }
  async match(req) { const stored = this.store.get(keyOf(req)); return stored ? stored.clone() : undefined; }
  async put(req, res) {
    this.putCalls += 1;
    if (this.failPut) throw new Error("QuotaExceededError");
    this.store.set(keyOf(req), res.clone());
  }
  async keys() { return [...this.store.keys()].map((url) => ({ url })); }
  async delete(req) { return this.store.delete(keyOf(req)); }
}

class FakeCacheStorage {
  constructor() { this.caches = new Map(); }
  seed(name, cache) { this.caches.set(name, cache); return cache; }
  ensure(name) { if (!this.caches.has(name)) this.caches.set(name, new FakeCache()); return this.caches.get(name); }
  async open(name) { return this.ensure(name); }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
  async match(req) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

const makeRequest = (url, opts = {}) => ({ url, method: opts.method || "GET", cache: opts.cache, destination: opts.destination, mode: opts.mode });

function loadServiceWorker({ origin = ORIGIN } = {}) {
  const handlers = {};
  const cacheStorage = new FakeCacheStorage();
  let fetchImpl = async () => { throw new Error("fetch not configured for this test"); };
  const self = {
    location: { origin },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  const sandbox = { self, caches: cacheStorage, URL, console, fetch: (req) => fetchImpl(req) };
  sandbox.globalThis = sandbox;
  // Append an assignment so the module's top-level consts (const, not attached to the
  // vm global) become readable from the test.
  const source = `${fs.readFileSync(SW_PATH, "utf8")}\nself.__consts = { VERSION, DATA, POSTERS, SHELL, CACHE_PREFIX };`;
  vm.runInNewContext(source, sandbox);
  return { handlers, cacheStorage, consts: self.__consts, setFetch: (fn) => { fetchImpl = fn; } };
}

async function dispatchFetch(sw, request) {
  const event = { request, _waits: [], respondWith(p) { this._response = p; }, waitUntil(p) { this._waits.push(p); } };
  sw.handlers.fetch(event);
  const responded = "_response" in event;
  let response;
  let error;
  if (responded) {
    try { response = await event._response; } catch (err) { error = err; }
  }
  await Promise.allSettled(event._waits);
  return { responded, response, error };
}

async function dispatchActivate(sw) {
  const event = { _waits: [], waitUntil(p) { this._waits.push(p); } };
  sw.handlers.activate(event);
  await Promise.allSettled(event._waits);
}

// ---- Tests ----------------------------------------------------------------

const { tests, test } = createTestRegistry();

test("no-store CSV: a fresh 2xx CSV is returned and written to the data cache", async () => {
  const sw = loadServiceWorker();
  sw.setFetch(async () => csvResponse("NEW"));
  const { response } = await dispatchFetch(sw, makeRequest(CSV_URL, { cache: "no-store" }));
  assert.equal(response.id, "NEW");
  const dataCache = sw.cacheStorage.caches.get(sw.consts.DATA);
  const cached = await dataCache.match(makeRequest(CSV_URL));
  assert.equal(cached.id, "NEW");
});

test("no-store CSV: a 5xx response falls back to the cached CSV and does not overwrite it", async () => {
  const sw = loadServiceWorker();
  const dataCache = sw.cacheStorage.seed(sw.consts.DATA, new FakeCache());
  await dataCache.put(makeRequest(CSV_URL), csvResponse("OLD"));
  sw.setFetch(async () => csvResponse("ERR", 503));

  const { response } = await dispatchFetch(sw, makeRequest(CSV_URL, { cache: "no-store" }));
  assert.equal(response.id, "OLD", "should serve the last good CSV, not the 503");
  const stillCached = await dataCache.match(makeRequest(CSV_URL));
  assert.equal(stillCached.id, "OLD", "503 must not replace the cached CSV");
});

test("no-store CSV: a 200 HTML login/quota page cannot poison the cache", async () => {
  const sw = loadServiceWorker();
  const dataCache = sw.cacheStorage.seed(sw.consts.DATA, new FakeCache());
  await dataCache.put(makeRequest(CSV_URL), csvResponse("OLD"));
  sw.setFetch(async () => htmlResponse("LOGIN"));

  const { response } = await dispatchFetch(sw, makeRequest(CSV_URL, { cache: "no-store" }));
  assert.equal(response.id, "OLD", "HTML page must fall back to cached CSV");
  const stillCached = await dataCache.match(makeRequest(CSV_URL));
  assert.equal(stillCached.id, "OLD", "an HTML body must never overwrite the cached CSV");
});

test("no-store CSV: offline returns the cached CSV, or rejects when there is none", async () => {
  const swWithCache = loadServiceWorker();
  const dataCache = swWithCache.cacheStorage.seed(swWithCache.consts.DATA, new FakeCache());
  await dataCache.put(makeRequest(CSV_URL), csvResponse("OLD"));
  swWithCache.setFetch(async () => { throw new Error("offline"); });
  const offline = await dispatchFetch(swWithCache, makeRequest(CSV_URL, { cache: "no-store" }));
  assert.equal(offline.response.id, "OLD");

  const swEmpty = loadServiceWorker();
  swEmpty.setFetch(async () => { throw new Error("offline"); });
  const noCache = await dispatchFetch(swEmpty, makeRequest(CSV_URL, { cache: "no-store" }));
  assert.ok(noCache.error, "with no cached CSV and no network, the request should reject");
});

test("stale-while-revalidate CSV: serves cache instantly, then revalidates with a valid CSV only", async () => {
  const sw = loadServiceWorker();
  const dataCache = sw.cacheStorage.seed(sw.consts.DATA, new FakeCache());
  await dataCache.put(makeRequest(CSV_URL), csvResponse("OLD"));
  sw.setFetch(async () => csvResponse("NEW"));

  const { response } = await dispatchFetch(sw, makeRequest(CSV_URL));
  assert.equal(response.id, "OLD", "cached copy is served immediately");
  const revalidated = await dataCache.match(makeRequest(CSV_URL));
  assert.equal(revalidated.id, "NEW", "background revalidation should refresh the cache");
});

test("stale-while-revalidate CSV: an HTML revalidation does not overwrite the cached CSV", async () => {
  const sw = loadServiceWorker();
  const dataCache = sw.cacheStorage.seed(sw.consts.DATA, new FakeCache());
  await dataCache.put(makeRequest(CSV_URL), csvResponse("OLD"));
  sw.setFetch(async () => htmlResponse("LOGIN"));

  const { response } = await dispatchFetch(sw, makeRequest(CSV_URL));
  assert.equal(response.id, "OLD");
  const stillCached = await dataCache.match(makeRequest(CSV_URL));
  assert.equal(stillCached.id, "OLD");
});

test("activate: purges old versioned caches but keeps the data, posters and current caches", async () => {
  const sw = loadServiceWorker();
  const { VERSION, DATA, POSTERS } = sw.consts;
  for (const name of [`${VERSION}-shell`, "mlx-8.8.10-shell", "mlx-8.8.10-data", DATA, POSTERS, "some-other-app-cache"]) {
    sw.cacheStorage.seed(name, new FakeCache());
  }

  await dispatchActivate(sw);
  const remaining = await sw.cacheStorage.keys();

  assert.ok(remaining.includes(`${VERSION}-shell`), "current shell cache is kept");
  assert.ok(remaining.includes(DATA), "version-independent data cache is kept across upgrades");
  assert.ok(remaining.includes(POSTERS), "posters cache is kept");
  assert.ok(remaining.includes("some-other-app-cache"), "caches from other apps on the origin are untouched");
  assert.ok(!remaining.includes("mlx-8.8.10-shell"), "old versioned shell cache is purged");
  assert.ok(!remaining.includes("mlx-8.8.10-data"), "old versioned data cache is purged");
});

test("activate: migrates a previous versioned data cache into the stable data cache", async () => {
  const sw = loadServiceWorker();
  const { VERSION, DATA } = sw.consts;
  // A client updating from an earlier release has its last good CSV under the old
  // versioned name; activate must carry it over so offline recovery still works.
  const legacy = sw.cacheStorage.seed(`${VERSION}-data`, new FakeCache());
  await legacy.put(makeRequest(CSV_URL), csvResponse("PRESERVED"));

  await dispatchActivate(sw);

  const remaining = await sw.cacheStorage.keys();
  assert.ok(!remaining.includes(`${VERSION}-data`), "the old versioned data cache is removed after migration");
  const migrated = await sw.cacheStorage.caches.get(DATA).match(makeRequest(CSV_URL));
  assert.equal(migrated.id, "PRESERVED", "the last good CSV is preserved in the stable data cache");
});

test("activate: migration does not overwrite a fresher entry already in the stable cache", async () => {
  const sw = loadServiceWorker();
  const { VERSION, DATA } = sw.consts;
  const current = sw.cacheStorage.seed(DATA, new FakeCache());
  await current.put(makeRequest(CSV_URL), csvResponse("FRESH"));
  const legacy = sw.cacheStorage.seed(`${VERSION}-data`, new FakeCache());
  await legacy.put(makeRequest(CSV_URL), csvResponse("STALE"));

  await dispatchActivate(sw);

  const kept = await sw.cacheStorage.caches.get(DATA).match(makeRequest(CSV_URL));
  assert.equal(kept.id, "FRESH", "an existing stable-cache entry is not clobbered by an older versioned one");
});

test("poster: a valid image is returned and cached; a cache.put quota error fails open", async () => {
  const sw = loadServiceWorker();
  const postersCache = sw.cacheStorage.seed(sw.consts.POSTERS, new FakeCache({ failPut: true }));
  sw.setFetch(async () => imageResponse("IMG"));

  const { response } = await dispatchFetch(sw, makeRequest(POSTER_URL, { destination: "image" }));
  assert.equal(response.id, "IMG", "a quota rejection on cache.put must not break the image");
  assert.ok(postersCache.putCalls > 0, "the worker still attempts to cache the poster");
});

test("poster: a cached image is served first, then refreshed in the background", async () => {
  const sw = loadServiceWorker();
  const postersCache = sw.cacheStorage.seed(sw.consts.POSTERS, new FakeCache());
  await postersCache.put(makeRequest(POSTER_URL, { destination: "image" }), imageResponse("CACHED"));
  sw.setFetch(async () => imageResponse("FRESH"));

  const { response } = await dispatchFetch(sw, makeRequest(POSTER_URL, { destination: "image" }));
  assert.equal(response.id, "CACHED", "cache-first: the cached poster is served immediately");
  const refreshed = await postersCache.match(makeRequest(POSTER_URL, { destination: "image" }));
  assert.equal(refreshed.id, "FRESH", "the background fetch refreshes the poster cache");
});

test("non-GET requests are ignored by the service worker", async () => {
  const sw = loadServiceWorker();
  const { responded } = await dispatchFetch(sw, makeRequest(CSV_URL, { cache: "no-store", method: "POST" }));
  assert.equal(responded, false, "POST requests must not be intercepted");
});

runTests(tests, { label: "service worker scenarios" });
