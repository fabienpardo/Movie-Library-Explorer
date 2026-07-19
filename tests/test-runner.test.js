#!/usr/bin/env node
// Meta-test: proves the lightweight custom runner actually reports failures.
// A hand-rolled runner can silently pass (swallowed throws, unset exit code), which would
// make every other suite untrustworthy. This guards the harness the whole project relies on.
const assert = require('node:assert/strict');
const { createTestRegistry, runTests } = require('./helpers/test-runner');
const {
  shouldRelaunchWithWebSocketFlag,
  supportsExperimentalWebSocketFlag
} = require('./helpers/run-e2e');
const { startChromiumWithRetry } = require('./helpers/browser-runner');

async function silenced(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try { await fn(); } finally { console.log = log; console.error = error; }
}

(async () => {
  // A thrown Error must flag a non-zero exit code.
  const throwing = createTestRegistry();
  throwing.test("passes", () => {});
  throwing.test("throws on purpose", () => { throw new Error("intentional"); });
  await silenced(() => runTests(throwing.tests, { label: "self-check" }));
  assert.equal(process.exitCode, 1, "runner must set exitCode=1 when a test throws");

  // A failed assertion (not just a raw throw) must also be reported.
  process.exitCode = 0;
  const asserting = createTestRegistry();
  asserting.test("failed assertion", () => assert.equal(1, 2));
  await silenced(() => runTests(asserting.tests, { label: "self-check" }));
  assert.equal(process.exitCode, 1, "runner must report a failed assertion");

  // A fully passing run must leave the exit code clean.
  process.exitCode = 0;
  const passing = createTestRegistry();
  passing.test("a", () => {});
  passing.test("b", () => {});
  await silenced(() => runTests(passing.tests, { label: "self-check" }));
  assert.notEqual(process.exitCode, 1, "runner must not flag a clean run");

  assert.equal(supportsExperimentalWebSocketFlag('20.9.0'), false, 'Node 20.0-20.9 must preserve the E2E skip path');
  assert.equal(supportsExperimentalWebSocketFlag('20.10.0'), true, 'Node 20.10+ can use --experimental-websocket');
  assert.equal(shouldRelaunchWithWebSocketFlag({ hasWebSocket: false, reexec: undefined, version: '20.9.0' }), false);
  assert.equal(shouldRelaunchWithWebSocketFlag({ hasWebSocket: false, reexec: undefined, version: '20.10.0' }), true);
  assert.equal(shouldRelaunchWithWebSocketFlag({ hasWebSocket: true, reexec: undefined, version: '20.10.0' }), false);
  assert.equal(shouldRelaunchWithWebSocketFlag({ hasWebSocket: false, reexec: '1', version: '20.10.0' }), false);

  const attempts = [];
  const cleanedProfiles = [];
  const browser = await startChromiumWithRetry('retry self-check', {
    start() {
      const profileDir = `profile-${attempts.length + 1}`;
      attempts.push(profileDir);
      return {
        profileDir,
        ready: attempts.length === 1
          ? Promise.reject(new Error('intentional startup failure'))
          : Promise.resolve({ wsUrl: 'ws://browser.test', profileDir })
      };
    },
    cleanup: async chromium => cleanedProfiles.push(chromium.profileDir),
    onRetry() {},
    wait: promise => promise
  });
  assert.equal(browser.browserWsUrl, 'ws://browser.test', 'browser startup should return the successful retry');
  assert.deepEqual(attempts, ['profile-1', 'profile-2'], 'browser startup should retry once');
  assert.deepEqual(cleanedProfiles, ['profile-1'], 'failed browser startup should always be cleaned up');

  const failedProfiles = [];
  let failedAttempt = 0;
  await assert.rejects(
    startChromiumWithRetry('failure self-check', {
      start() {
        failedAttempt += 1;
        return { profileDir: `failed-${failedAttempt}`, ready: Promise.reject(new Error(`failure ${failedAttempt}`)) };
      },
      cleanup: async chromium => failedProfiles.push(chromium.profileDir),
      onRetry() {},
      wait: promise => promise
    }),
    /failure 2/,
    'the final browser startup error should be returned after one retry'
  );
  assert.deepEqual(failedProfiles, ['failed-1', 'failed-2'], 'every failed browser process should be cleaned up');

  process.exitCode = 0;
  console.log("✓ runner reports thrown errors, failed assertions, clean runs and E2E wrapper decisions correctly");
  console.log("\n1/1 runner self-check passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
