# Tests

This folder contains test-only assets and scenarios. It is not used by the deployed app unless a test flag is explicitly passed.

## Fixture

- `fixtures/apple-tv-movies-library-mdb.csv`: local CSV copy of the Apple TV movie library, used only by tests.

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

Coverage (unit layer, via on-demand `c8` — no committed dependency):

```bash
npm run test:coverage   # prints a summary and writes coverage/index.html
```

Direct commands:

```bash
node tests/regression.test.js
node tests/static-assets.test.js
node tests/e2e.browser.test.js
```

## Requirements

- Node.js. The unit and asset layers run on any maintained version.
- The browser E2E layer additionally needs a global `WebSocket` (Node 22+, or `node --experimental-websocket`) and a Chromium/Chrome binary. When either is missing, `test:e2e` prints a skip notice and exits 0 so `npm test` stays green.

The browser runner is dependency-free and uses the Chrome DevTools Protocol directly. If Chromium is not installed in a standard path, run with:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Covered scenarios

### Unit / data regression

1. The fixture CSV can be parsed.
2. The app detects the expected movie-library columns.
3. Default `Position` descending sort returns the latest library positions first.
4. Title sorting/comparison ignores leading articles, case, accents and edge punctuation.
5. Duplicate original titles are hidden after normalization.
6. Release sorting uses `Release Date` before the `Year` fallback.
7. `Tous` vs `Au moins un` filter modes behave correctly.
8. Filter option counts are sorted by descending count.
9. Runtime formatting, IMDb rating classes and IMDb URL validation still work.
10. Stable movie IDs prefer IMDb URLs before normalized fallback IDs.
11. Temporary selection state stays independent from filtering.
12. Missing URL columns emit a persistence-stability warning.
13. Legacy persisted movie IDs are reconciled to the explicit v8.4.2 ID format.
14. Selection detail DOM IDs are sanitized by a dedicated helper.
15. Search matches real cell values only and ignores the synthetic movie ID.
16. `escapeHtml` neutralizes HTML metacharacters and stays wired into rendered card markup (XSS guard).
17. `parseCsv` handles quoted delimiters, escaped quotes, embedded newlines, CRLF and blank lines.
18. `parseRuntime` and `parseDateValue` cover every supported input shape.
19. `baseOptionCounts` memoizes per input state and recomputes when filters change.

### Static asset checks

1. `index.html` references only existing local assets.
2. The manifest references existing icons.
3. Cache-busting versions stay aligned with the package version.
4. Removed UI features and fragile selector patterns stay absent.
5. Mobile card-only mode does not keep mobile list-view CSS overrides.
6. Roadmap CSS hooks exist for sticky summary and list view.
7. Robustness cleanup helpers remain present.
8. The CSV fixture stays isolated under `tests/fixtures` and the production data source remains the default.

### Browser E2E checks

1. The app renders the fixture library without browser errors.
2. Search reduces results and `Tout effacer` restores the full set.
3. Genre checkbox selection updates cards, badges and selected chips.
4. Card filter buttons toggle filters on and off.
5. Sort options update the first rendered card consistently with app sorting logic.
6. The sticky result summary tracks filters, sort and selection count.
7. Display settings switch between cards/list without losing filters on desktop, including compact list posters.
8. Mobile keeps card view and hides the display-mode selector.
9. Temporary selection can add, review, remove and clear movies.
10. Failed reload clears stale cards, active filters and filter lists.
11. Mobile filter panel opens as a dialog and closes on Escape.
12. Mobile actor search result can be selected with the first touch after typing.
