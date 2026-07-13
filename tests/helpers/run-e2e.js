#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Defaults to the E2E suite; an explicit path (e.g. the localhost smoke test) can be
// passed as the first CLI arg. Both need the same --experimental-websocket relaunch.
const testFile = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', 'e2e.browser.test.js');

function supportsExperimentalWebSocketFlag(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 10);
}

function shouldRelaunchWithWebSocketFlag({ hasWebSocket = typeof WebSocket !== 'undefined', reexec = process.env.MOVIE_EXPLORER_E2E_WEBSOCKET_REEXEC, version = process.versions.node } = {}) {
  return !hasWebSocket && reexec !== '1' && supportsExperimentalWebSocketFlag(version);
}

function run() {
  if (!shouldRelaunchWithWebSocketFlag()) {
    require(testFile);
    return;
  }

  const result = spawnSync(process.execPath, ['--experimental-websocket', testFile], {
    stdio: 'inherit',
    env: { ...process.env, MOVIE_EXPLORER_E2E_WEBSOCKET_REEXEC: '1' }
  });

  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}

if (require.main === module) run();

module.exports = {
  shouldRelaunchWithWebSocketFlag,
  supportsExperimentalWebSocketFlag
};
