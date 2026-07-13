#!/usr/bin/env node
// Localhost smoke test: unlike the E2E suite (which rewrites modules to blobs, blocks
// HTTP and injects a fake fetch), this serves the REAL project over http://127.0.0.1
// and loads it unmodified — exercising the production entry point (script.js), real
// static module URLs, service-worker registration/install, and the real fixture fetch.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createTestRegistry, runTests } = require('./helpers/test-runner');
const { setupBrowserTests, teardownBrowserTests, assertNoBrowserDiagnostics } = require('./helpers/browser-runner');
const { createRawPage, evaluate, evaluateFunction, waitForExpression, withTimeout } = require('./browser-test-utils');
const { startStaticServer } = require('./helpers/static-server');

const rootDir = path.resolve(__dirname, '..');
// Drop external poster CDNs so the load is deterministic and offline-safe; the cards
// render from the local fixture regardless (posters fall back to initials).
const BLOCKED_POSTER_HOSTS = ['https://*.mzstatic.com/*', 'https://m.media-amazon.com/*'];

const { tests, test } = createTestRegistry();

test('production entry boots the real app, loads the fixture, and registers the service worker', async ({ baseUrl }) => {
  const { page } = await createRawPage(globalThis.__smokeBrowserWsUrl, { blockedUrls: BLOCKED_POSTER_HOSTS });
  await page.send('Page.navigate', { url: `${baseUrl}/?fixture=1` });

  // The real module graph + entry point must boot and render cards from the fixture.
  await waitForExpression(page, "document.querySelectorAll('.movie-card').length > 0", 'cards render from real modules', 20000);

  const snapshot = await evaluateFunction(page, () => {
    const posterCard = document.querySelector('.movie-card--media.movie-card--with-poster');
    const style = posterCard ? getComputedStyle(posterCard) : null;
    return {
      cards: document.querySelectorAll('.movie-card').length,
      statusHidden: document.querySelector('#status').hidden,
      hasProductionHooks: typeof window.__MovieExplorerTestHooks,
      scriptSrc: document.querySelector('script[src^="script.js"]') ? true : false,
      posterCardDisplay: style?.display,
      posterCardGridColumns: style?.gridTemplateColumns
    };
  });
  assert.ok(snapshot.cards > 0, 'the real app renders cards');
  assert.equal(snapshot.statusHidden, true, 'the loading message is dismissed once data renders');
  // Guards the editorial card layout (and the dead-grid cleanup): the poster card is a
  // block, not the old horizontal grid.
  assert.equal(snapshot.posterCardDisplay, 'block', 'poster cards use the editorial block layout');
  assert.equal(snapshot.posterCardGridColumns, 'none', 'no obsolete grid-template-columns leaks onto the block card');
  // Production must NOT expose the test surface (it is only installed by the test harness).
  assert.equal(snapshot.hasProductionHooks, 'undefined', 'production build does not leak __MovieExplorerTestHooks');
  assert.equal(snapshot.scriptSrc, true, 'the production script.js entry point is used');

  // The service worker registers, installs and activates over http://127.0.0.1.
  const swActive = await withTimeout(
    evaluate(page, 'navigator.serviceWorker.ready.then(reg => Boolean(reg && reg.active))'),
    15000,
    'service worker activation'
  );
  assert.equal(swActive, true, 'the service worker registers and activates');

  // ...and precaches the app shell so the app is offline-capable.
  const hasShellCache = await evaluate(page, "caches.keys().then(keys => keys.some(k => k.includes('shell')))");
  assert.equal(hasShellCache, true, 'the service worker precaches an app-shell cache');
});

async function run() {
  const browser = await setupBrowserTests('localhost smoke test');
  if (browser.skipped) return;
  // Stash the ws URL for the test (context also carries it, but a global keeps the
  // test body symmetrical with the E2E harness's createPage(browserWsUrl)).
  globalThis.__smokeBrowserWsUrl = browser.browserWsUrl;

  const server = await startStaticServer(rootDir);
  try {
    await runTests(tests, {
      label: 'smoke scenarios',
      setup: () => ({ ...browser, baseUrl: server.origin }),
      afterEach: assertNoBrowserDiagnostics,
      timeout: (promise, label) => withTimeout(promise, 45000, label)
    });
  } finally {
    await server.close();
    await teardownBrowserTests(browser);
  }
}

run();
