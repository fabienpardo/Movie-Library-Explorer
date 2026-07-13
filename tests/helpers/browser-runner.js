const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  browserTestSkipReason,
  flushPages,
  startChromium,
  withTimeout
} = require('../browser-test-utils');
const { runTests } = require('./test-runner');

function stopChromium(chromium) {
  return new Promise(resolve => {
    const child = chromium.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { process.kill(-child.pid, 'SIGTERM'); } catch {
      try { child.kill('SIGTERM'); } catch {}
      clearTimeout(timer);
      resolve();
    }
  });
}

async function setupBrowserTests(testName = 'browser E2E tests') {
  const skipReason = browserTestSkipReason();
  if (skipReason) {
    // A silent skip in CI would let a missing/broken browser masquerade as a pass.
    // Fail hard there unless an operator explicitly opts into skipping.
    if (process.env.CI && process.env.ALLOW_BROWSER_TEST_SKIP !== '1') {
      throw new Error(`Browser E2E tests cannot run in CI: ${skipReason} Set ALLOW_BROWSER_TEST_SKIP=1 to skip intentionally.`);
    }
    console.log(`⚠ Skipping browser E2E tests: ${skipReason}`);
    return { skipped: true };
  }

  const chromium = startChromium();
  const { wsUrl: browserWsUrl } = await withTimeout(chromium.ready, 15000, `start Chromium for ${testName}`);
  return { chromium, browserWsUrl };
}

async function teardownBrowserTests(context) {
  if (!context || context.skipped) return;
  await stopChromium(context.chromium);
  try { fs.rmSync(context.chromium.profileDir, { recursive: true, force: true }); } catch {}
}

async function assertNoBrowserDiagnostics(testCase) {
  for (const diagnostics of await withTimeout(flushPages(), 12000, `flush pages for ${testCase.name}`)) {
    assert.deepEqual(diagnostics.consoleErrors, [], `console errors during "${testCase.name}"`);
    assert.deepEqual(diagnostics.exceptions, [], `uncaught exceptions during "${testCase.name}"`);
  }
}

async function runBrowserTests(tests) {
  const context = await setupBrowserTests();
  if (context.skipped) return;
  await runTests(tests, {
    label: 'browser E2E scenarios',
    setup: () => context,
    teardown: teardownBrowserTests,
    afterEach: assertNoBrowserDiagnostics,
    timeout: (promise, label) => withTimeout(promise, 30000, label)
  });
}

async function runOneBrowserTest(testCase) {
  if (!testCase) throw new Error('Unknown E2E test index');
  const context = await setupBrowserTests(testCase.name);
  if (context.skipped) return;
  try {
    await withTimeout(testCase.fn(context), 30000, testCase.name);
    await assertNoBrowserDiagnostics(testCase);
    console.log(`✓ ${testCase.name}`);
  } finally {
    await teardownBrowserTests(context);
  }
}

module.exports = { runBrowserTests, runOneBrowserTest, setupBrowserTests, teardownBrowserTests, assertNoBrowserDiagnostics };
