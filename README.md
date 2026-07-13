# Explorateur de films

Static, browser-only movie-library explorer for a published Google Sheet CSV.

The app is built for GitHub Pages: no backend, no bundler, and no runtime npm dependencies. It loads the CSV directly in the browser, maps the relevant columns by fixed name, then renders a card grid with search, sorting, filters, IMDb links, posters, saga badges, and a temporary local selection panel.

## Current behavior

- French UI.
- Card grid on every viewport. There is no list view and no display-mode selector.
- The grid renders an initial capped batch of cards, with an `Afficher plus` button for the next batch.
- Sticky result summary showing displayed movies, active sort, active filters, and temporary selection count.
- Filters by genre, actor, director, and saga.
- Genre / actor / director filters support `Tous` and `Au moins un` matching.
- Actor and director filter lists are searchable.
- Clicking genre, actor, director, or saga chips inside a card toggles the matching filter.
- Saga badges show their selected state when a saga filter is active.
- Temporary selection is stored in `localStorage` and can be reviewed, expanded, removed, or cleared.
- Poster URLs are read from the sheet and rendered with fallback initials when loading fails.
- IMDb title URLs open in a new tab from the movie title.
- Mobile filter panel is modal-like, inert when closed, and usable on iPhone Safari.

## Data source

The source is configured in `src/config.mjs`:

```js
export const PUBLISHED_SHEET_ID = "...";
export const GID = "70337195";
```

The app builds this CSV URL:

```js
https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv
```

To change the source, publish the Google Sheet to the web as CSV, then update `PUBLISHED_SHEET_ID` and `GID`.

## Expected columns

Columns are mapped by fixed name in `COLUMNS` (`src/config.mjs`): the published sheet always uses the exact headers below (matching the test fixture), so there is no fuzzy detection. The columns are:

| Purpose | Current column |
|---|---|
| Library position | `Position` |
| Display title | `Title` |
| Original title | `Original Title` |
| IMDb URL | `URL` |
| IMDb rating | `IMDb Rating` |
| Runtime | `Runtime (mins)` |
| Year | `Year` |
| Release date | `Release Date` |
| Genres | `Genres` |
| Directors | `Directors` |
| Actors | `Main actors` |
| Country | `Country` |
| Saga name | `Saga name` |
| Saga order | `Saga order` |
| Poster image | `Poster` |

If a header in the sheet is renamed, update `COLUMNS` to match; a regression test guards that every mapped name exists in the fixture header.

## Sorting

Available sort options:

- Ajout récent / Ajout ancien: uses `Position` descending or ascending.
- Titre A → Z: uses normalized title sorting.
- Titre original A → Z: uses normalized original-title sorting, falling back to display title.
- Durée courte → longue / Durée longue → courte: parses runtime values as minutes.
- IMDb meilleure note: uses IMDb rating descending.
- Sortie récente / Sortie ancienne: uses `Release Date` first, then `Year` as fallback.
- Pays A → Z: uses the first country value.

Title sorting ignores leading articles such as `Le`, `La`, `Les`, `L’`, `The`, `A`, and `An`, and normalizes accents and edge punctuation.

## Filters

Genre, actor, and director filters are derived from comma-, semicolon-, or pipe-separated cell values.

Filter option counts are scoped to the current search, match modes, selected category filters, and selected saga filters. This prevents stale actor/director/genre counts after clicking a saga badge.

The active filter chips are separate from the filter-tab navigation. Switching filter tabs only updates `.filter-jump-nav__button` elements, not active-filter remove buttons.

## Poster behavior

Poster URLs are accepted only when they are safe image URLs. The app supports normal HTTP(S) image URLs and safe image data URLs. Broken posters fall back to an initials tile and are remembered during the session so the app does not keep retrying known-failed URLs.

Browser E2E tests block external image requests to keep the suite deterministic. The production app still uses the poster URLs from the sheet.

## Local development

No install step is required for the app itself. Node is only used for tests, and the
dev tooling (ESLint, c8) is pinned via `package-lock.json` — install it once with
`npm ci` before running the suites:

```bash
npm ci
npm run lint
npm run test:unit
npm run test:assets
npm run test:e2e
npm test
```

Coverage uses `c8` and enforces minimum thresholds (build fails below them):

```bash
npm run test:coverage
```

The browser E2E suite requires Chromium or Chrome. Set `CHROMIUM_PATH` if it is not in a standard location. On Node 20.10+, the `npm run test:e2e` script relaunches the suite with the WebSocket flag that Chrome DevTools Protocol needs; earlier Node 20 releases keep the existing skip behavior because that flag is unavailable.

## Test fixtures

- `tests/fixtures/apple-tv-movies-library-mdb.csv`: full regression fixture used by unit tests.
- `tests/fixtures/e2e-movies-library-mdb.csv`: smaller browser fixture used by E2E tests for faster and more stable browser runs.

## Project structure

```text
index.html
style.css
script.js                  # thin browser entry point
src/
  app.mjs                  # app orchestration, data loading, events, viewport behavior
  config.mjs               # sheet URL, constants, fixed COLUMNS map, category config
  data.mjs                 # CSV parsing, row/cell helpers, movie IDs, saga helpers
  dom.mjs                  # element creation and child-replacement helpers
  filter-panel.mjs         # filter drawer open/close, focus trap, back-to-top
  matching.mjs             # filtering, option counts, active-filter derivation
  render-cards.mjs         # movie view model, card DOM, grid reconciliation, poster state
  render-filters.mjs       # filter lists, summary, diagnostics, control sync
  selection.mjs            # temporary selection state, panel, count sync
  sorting.mjs              # sort labels, normalized title sorting, comparison logic
  state.mjs                # shared state, DOM cache, poster caches, localStorage persistence
  test-hooks.mjs           # test surface (installs window.__MovieExplorerTestHooks)
  utils.mjs                # pure formatting, parsing, normalization, HTML/DOM safety helpers
manifest.webmanifest
icons
package.json
tests/
  helpers/                 # shared runner, app-hook setup, browser runner lifecycle
  browser-test-utils.js    # low-level CDP/browser page utilities
  e2e.browser.test.js
  regression.test.js
  static-assets.test.js
  fixtures/
```

## Stylesheet organization

`style.css` is kept as a single deployable stylesheet, but it is organized by responsibility:

```text
01 tokens
02 base
03 layout
04 toolbar
05 filter panel
06 movie card
07 selection panel
08 responsive
09 utilities
```

Static tests validate this section order so future CSS changes do not drift back into historical override layers.

## Runtime entry point

`script.js` is intentionally small. It dynamically imports `src/app.mjs`, then initializes the app unless `window.MOVIE_EXPLORER_SKIP_AUTO_INIT` is set by tests. The test suites import `src/test-hooks.mjs` themselves, so production does not expose internal test helpers.

This keeps GitHub Pages deployment simple while allowing the app code to be organized into native browser ES modules without a bundler.

## Tests

The test suite has five layers:

- Unit/data regression tests for parsing, detection, sorting, filtering, IDs, cache behavior, and safety helpers.
- Static asset tests for cache-busting, removed-code guards, asset references, CSS section order, safe-rendering guards, and project invariants.
- Service-worker behavior tests (`tests/sw.test.js`) that load `sw.js` in a mocked worker scope and exercise CSV validation/fallback, cache-poisoning prevention, activation/cache-migration, and poster fail-open.
- Browser E2E tests using Chromium and the Chrome DevTools Protocol, with external image loading blocked for determinism.
- A localhost smoke test (`tests/smoke.browser.test.js`) that serves the real, unmodified app over `http://127.0.0.1` and verifies the production entry point boots, the fixture loads, and the service worker registers/activates and precaches the shell.

Common test-runner, app-fixture, and browser-lifecycle logic lives under `tests/helpers/` so individual test files focus on scenarios instead of boilerplate.

Current expected result:

```text
30/30 regression scenarios passed.
13/13 static asset scenarios passed.
12/12 service worker scenarios passed.
17/17 browser E2E scenarios passed.
1/1 smoke scenarios passed.
```

## Deployment

The app can be deployed as static files on GitHub Pages.

When changing CSS, JavaScript, manifest, or icons, keep cache-busting query strings aligned. The current expected asset version is `8.8.11`, and the static asset test validates that version alignment.
