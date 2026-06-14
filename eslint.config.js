// Minimal flat config. Primary purpose: `no-unused-vars` catches the dead-import / imported-only-
// for-reexport smell that motivated splitting test-hooks.mjs out of app.mjs. Run with: npm run lint.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  HTMLElement: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Blob: "readonly",
  CSS: "readonly",
  requestAnimationFrame: "readonly",
  fetch: "readonly",
  Event: "readonly",
  console: "readonly"
};

const nodeGlobals = {
  require: "readonly",
  module: "writable",
  process: "readonly",
  __dirname: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
  Blob: "readonly",
  WebSocket: "readonly",
  global: "writable",
  window: "readonly",
  document: "readonly",
  HTMLElement: "writable"
};

module.exports = [
  {
    files: ["src/**/*.mjs", "script.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: browserGlobals },
    rules: { "no-unused-vars": "error" }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: nodeGlobals },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  }
];
