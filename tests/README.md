# Tests

This folder contains test-only assets and scenarios. It is not used by the deployed app unless a test flag is explicitly passed.

## Fixtures

- `fixtures/apple-tv-movies-library-mdb.csv`: full local CSV copy of the movie library, used by unit/regression tests.
- `fixtures/e2e-movies-library-mdb.csv`: smaller browser fixture used by the E2E layer to reduce Chromium runtime and avoid resource-pressure flakes.

## Run

From the package root:

```bash
npm test
```

Individual layers:

```bash
npm run test:unit
npm run test:assets
npm run test:e2e
```

Coverage is optional and uses on-demand `c8`:

```bash
npm run test:coverage
```

## Requirements

- Node.js.
- The browser E2E layer additionally needs a global `WebSocket` and a Chromium/Chrome binary.

When Chromium is not installed in a standard path, run with:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

If the browser layer cannot run in the current environment, it prints a skip notice and exits 0 so `npm test` remains usable.

## Browser runner notes

The browser runner is dependency-free and uses the Chrome DevTools Protocol directly. It loads the app module graph from `src/*.mjs` as Blob-backed ES modules inside the test page, then imports `src/app.mjs` and calls `initApp()`.

External HTTP(S) requests are blocked during E2E runs. `window.fetch` is replaced with a fixture-backed response, and poster images are not fetched from the network. This keeps the test suite deterministic while leaving production behavior unchanged.

## Covered scenarios

### Unit / data regression

Shared fixture setup and runner logic lives in `tests/helpers/app-hooks.js` and `tests/helpers/test-runner.js`; the regression file keeps the scenario assertions only.

1. The fixture CSV can be parsed.
2. The fixed column map matches every header in the fixture.
3. Default `Position` descending sort returns the latest library positions first.
4. Title sorting/comparison ignores leading articles, case, accents and edge punctuation.
5. Duplicate original titles are hidden after normalization.
6. Release sorting uses `Release Date` before the `Year` fallback.
7. `Tous` vs `Au moins un` filter modes behave correctly.
8. Filter option counts are sorted by descending count.
9. Runtime formatting, IMDb rating classes and IMDb URL validation still work.
10. Stable movie IDs prefer IMDb URLs before normalized fallback IDs.
11. Temporary selection state stays independent from filtering.
12. Persisted selection IDs absent from the reloaded dataset are pruned.
13. Legacy persisted movie IDs are reconciled to the explicit v8.4.2 ID format.
14. Selection detail DOM IDs are sanitized by a dedicated helper.
15. Search matches real cell values only and ignores the synthetic movie ID.
16. `escapeHtml` neutralizes HTML metacharacters for the remaining non-DOM string contexts.
17. `parseCsv` handles quoted delimiters, escaped quotes, embedded newlines, CRLF and blank lines.
18. `parseRuntime` and `parseDateValue` cover every supported input shape.
19. `baseOptionCounts` memoizes per input state and recomputes when filters change.
20. Saga filter state is included in the option-count cache key.
21. Option-count cache size remains bounded.

### Static asset checks

Static tests use grouped pattern assertions so removed-code and safety guards can be extended without duplicating boilerplate.

1. `index.html` references only existing local assets.
2. The manifest references existing icons.
3. Cache-busting versions stay aligned with the package version.
4. Removed UI features and fragile selector patterns stay absent across `script.js` and `src/*.mjs`.
5. Card-only mode does not keep list-view code paths.
6. Stylesheet sections stay in the documented order.
7. Sticky summary and selection-detail hooks remain present.
8. Robustness helpers remain present after modularization.
9. Runtime source stays free of live `innerHTML`/`insertAdjacentHTML`/`outerHTML` injection.
10. Test fixtures remain isolated from the default production data source.

### Browser E2E

Browser lifecycle, timeout, page flushing, and diagnostics assertions live in `tests/helpers/browser-runner.js`; `e2e.browser.test.js` keeps scenario-level interactions.

1. The fixture renders without browser errors.
2. Search and clear filters work.
3. Genre selection updates cards, counts, and selected chips.
4. Match mode toggles between `Tous` and `Au moins un`.
5. Filter tab activation is scoped to navigation buttons.
6. Card filter buttons toggle filters on and off.
7. Saga badges filter the library.
8. Sorting changes the first rendered card consistently.
9. Sticky summary reflects filters, sort, and selection count.
10. Desktop and mobile both use card mode only.
11. Temporary selection can add, review, remove, and clear movies.
12. Failed reload clears stale state.
13. Mobile filter panel opens/closes as a dialog.
14. Mobile actor search results can be selected with the first touch after typing.
