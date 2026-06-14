#!/usr/bin/env node
// Meta-test: proves the lightweight custom runner actually reports failures.
// A hand-rolled runner can silently pass (swallowed throws, unset exit code), which would
// make every other suite untrustworthy. This guards the harness the whole project relies on.
const assert = require('node:assert/strict');
const { createTestRegistry, runTests } = require('./helpers/test-runner');

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

  process.exitCode = 0;
  console.log("✓ runner reports thrown errors, failed assertions and clean runs correctly");
  console.log("\n1/1 runner self-check passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
