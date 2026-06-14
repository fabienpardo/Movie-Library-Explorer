function createTestRegistry() {
  const tests = [];
  function test(name, fn) {
    tests.push({ name, fn });
  }
  return { tests, test };
}

async function runTests(tests, options = {}) {
  const {
    label = 'test',
    setup,
    teardown,
    afterEach,
    timeout
  } = options;

  const context = setup ? await setup() : undefined;
  let passed = 0;
  try {
    for (const testCase of tests) {
      const { name, fn } = testCase;
      try {
        if (timeout) await timeout(fn(context), name);
        else await fn(context);
        if (afterEach) await afterEach(testCase, context);
        passed += 1;
        console.log(`✓ ${name}`);
      } catch (error) {
        console.error(`✗ ${name}`);
        console.error(error.stack || error.message);
        process.exitCode = 1;
        break;
      }
    }

    if (process.exitCode !== 1) console.log(`\n${passed}/${tests.length} ${label} passed.`);
  } finally {
    if (teardown) await teardown(context);
  }
}

module.exports = { createTestRegistry, runTests };
