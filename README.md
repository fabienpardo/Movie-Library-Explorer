# Movie Library Explorer

A zero-build, static web app for exploring a personal movie library exported from a published Google Sheet.

The app is designed for GitHub Pages: no backend, no bundler, no runtime dependencies. It loads a CSV file in the browser, detects the relevant movie columns, then provides search, sorting, filters, desktop list view, mobile card view, and a temporary local selection workflow.

## Table of contents

- [What it does](#what-it-does)
- [Feature overview](#feature-overview)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [Data source](#data-source)
- [Expected columns](#expected-columns)
- [Testing](#testing)
- [Deployment](#deployment)
- [Browser and device behavior](#browser-and-device-behavior)
- [Persistence model](#persistence-model)
- [Maintenance notes](#maintenance-notes)
- [Known limitations](#known-limitations)

## What it does

Movie Library Explorer turns a movie spreadsheet into a fast browser-based exploration interface.

It is useful when you want to:

- browse a large movie library without opening the spreadsheet;
- search by title, actor, director, genre, country, or metadata;
- combine filters with `Tous` / `Au moins un` logic;
- compare candidate movies through a temporary local selection;
- use the same app on desktop and iPhone without a backend service.

The user interface is currently in French.

## Feature overview

### Search and filtering

- Global text search.
- Filters by genre, actor, and director.
- Per-category match modes:
  - `Tous`: every selected value in the category must match.
  - `Au moins un`: at least one selected value in the category must match.
- Dynamic filter options: values with no result are hidden unless already selected.
- Filter options sorted by descending result count.
- Clickable genre, actor, and director chips inside movie cards.
- Active-filter chips with deterministic category/value removal.

### Sorting

Available sort modes:

- library position, recent first;
- library position, oldest first;
- title A → Z;
- original title A → Z;
- runtime ascending / descending;
- IMDb rating descending;
- release date recent / old;
- country A → Z.

Title sorting normalizes leading articles, punctuation, accents, and case. For release sorting, `Release Date` is used first when available, with `Year` as fallback.

### Movie cards and list view

- The layout is chosen automatically by viewport, with no user-facing toggle: desktop (≥ 760px) uses the denser list view, and mobile uses card view.
- The layout switches live when the viewport crosses the breakpoint.
- IMDb rating visual classes:
  - high: `8.0+`;
  - medium: `7.0–7.9`;
  - low: below `7.0`.
- Movie title links to IMDb when a URL/IMDb column is detected.
- Poster images are displayed in cards when a poster/image-link column is detected.
- Original title is hidden when it is equivalent to the displayed title after normalization.

### Temporary selection

- Add/remove movies with a compact `+` / `✓` button on cards and list rows.
- Selection count shown in the toolbar and result summary.
- Selection panel with removable items.
- Full movie details can be expanded from the selection panel.
- Selection persists locally with `localStorage` when available.
- Legacy persisted selection IDs are reconciled to the current explicit ID format.

### Layout and accessibility

- Compact header.
- Sticky result summary.
- Mobile filter panel with dialog-style behavior.
- Focus trap for the mobile filter panel.
- `inert` support with fallback handling.
- Minimum touch target convention based on a `44px` tap target variable.
- Back-to-top button.
- PWA-oriented icons and manifest.

## Quick start

From the package root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

The app is static. Opening `index.html` directly from the filesystem may be blocked by browser CORS rules when the app fetches CSV data. Use a local HTTP server instead.

## Project structure

```text
.
├── index.html                      # App shell
├── style.css                       # Layout, responsive UI, component styles
├── script.js                       # CSV loading, data pipeline, rendering, state, interactions
├── manifest.webmanifest            # PWA metadata
├── favicon.svg                     # Vector favicon
├── favicon-16.png                  # PNG favicon
├── favicon-32.png                  # PNG favicon
├── apple-touch-icon.png            # iOS home-screen icon
├── icon-192.png                    # PWA icon
├── icon-512.png                    # PWA icon
├── package.json                    # Test scripts only; no runtime dependency
└── tests
    ├── README.md
    ├── fixtures
    │   └── apple-tv-movies-library-mdb.csv
    ├── regression.test.js          # Data and logic regression tests
    ├── static-assets.test.js       # Static integrity and cleanup checks
    ├── browser-test-utils.js       # Dependency-free Chromium/CDP helpers
    └── e2e.browser.test.js         # Browser-level E2E scenarios
```

## Data source

The production CSV source is configured at the top of `script.js`:

```js
const PUBLISHED_SHEET_ID = "...";
const GID = "0";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;
```

To use another Google Sheet:

1. Publish the relevant sheet tab as CSV.
2. Replace `PUBLISHED_SHEET_ID` and, if needed, `GID` in `script.js`.
3. Run the test suite.
4. Deploy the static files.

The test fixture is separate:

```text
tests/fixtures/apple-tv-movies-library-mdb.csv
```

It is used only by automated tests or by explicitly enabling fixture mode. The deployed app loads the published Google Sheet by default.

## Expected columns

Column detection is alias-based. If a sheet uses a different header name, update `columnAliases` near the top of `script.js`.

| Logical field | Supported examples |
|---|---|
| Title | `title`, `movie`, `movie title`, `name` |
| Original title | `original title`, `original name`, `original movie title` |
| Genres | `genre`, `genres` |
| Runtime | `runtime`, `runtime min`, `duration`, `running time` |
| Year | `year`, `release year`, `movie year` |
| Release date | `release date`, `released`, `premiere date`, `release` |
| Position | `position`, `library position`, `rank`, `order` |
| IMDb rating | `imdb rating`, `imdb`, `imdb score` |
| URL | `url`, `link`, `imdb url`, `imdb link`, `imdb page` |
| Poster | `poster`, `poster url`, `poster link`, `cover`, `cover url`, `image`, `image url`, `image link`, `affiche` |
| Country | `country`, `countries`, `production country`, `nationality` |
| Actors | `actor`, `actors`, `cast`, `stars`, `starring` |
| Directors | `director`, `directors`, `directed by` |

### Poster-column note

Poster images are optional. When a poster/image-link column is detected, cards render the image with lazy loading and a loading skeleton. Accepted values are `http://`, `https://`, or safe `data:image/...;base64` URLs. A broken image URL falls back to a gradient tile showing the title's initials, so one bad poster does not block the library. Poster load/error outcomes are remembered for the session so re-rendered cards (after filtering, sorting, or searching) do not re-show the skeleton or retry a known-broken image.

### Important URL-column note

Persisted selections are most stable when the CSV contains a URL/IMDb column.

Movie IDs use this priority:

```text
url:<normalized IMDb or movie URL>
fallback:<normalized title>:<year>:<position>
```

Without a URL/IMDb column, the fallback ID can become unstable if the title, year, or position changes in the spreadsheet. The app displays a warning when no URL/IMDb column is detected.

### Runtime assumption

Bare numeric runtime values are interpreted as minutes. For example:

```text
124 -> 124 minutes
```

This matches the current CSV fixture. If another data source stores runtime in hours or another unit, normalize the source data or adjust `parseRuntime()`.

## Testing

The project has three test layers:

```bash
npm test
```

Equivalent to:

```bash
npm run test:unit
npm run test:assets
npm run test:e2e
```

### Unit / regression tests

```bash
npm run test:unit
```

Covers:

- CSV parsing;
- column detection;
- default `Position desc` sorting;
- title normalization;
- duplicate original-title hiding;
- `Release Date` sorting with `Year` fallback;
- `Tous` vs `Au moins un` filter logic;
- filter option counts;
- runtime parsing and formatting;
- IMDb rating classes;
- IMDb URL validation;
- movie ID generation and legacy ID reconciliation;
- missing URL-column warning;
- selection state independence from active filters;
- safe DOM ID generation;
- poster URL detection and sanitization.

### Static asset and cleanup tests

```bash
npm run test:assets
```

Covers:

- local asset references in `index.html`;
- manifest icon references;
- cache-busting version alignment;
- absence of removed features such as density settings and old stat-card CSS;
- mobile card-only CSS expectations;
- presence of roadmap and robustness hooks;
- fixture isolation under `tests/fixtures`.

### Browser E2E tests

```bash
npm run test:e2e
```

Covers the app as a user would experience it in Chromium:

- fixture library rendering;
- search and clear behavior;
- genre filtering;
- card chip filter toggling;
- sorting;
- sticky result summary;
- desktop card/list mode switching;
- mobile card-only behavior;
- temporary selection add/review/remove/clear;
- failed reload cleanup;
- mobile filter dialog behavior;
- mobile actor-search first-touch selection.

The E2E runner is dependency-free and talks to Chromium through the Chrome DevTools Protocol.

If Chromium is not installed in a standard path:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Deployment

This app is intended to be deployed as static files, for example with GitHub Pages.

### GitHub Pages deployment

1. Commit the app files at the repository root.
2. In GitHub, open the repository settings.
3. Enable GitHub Pages for the relevant branch and root folder.
4. Wait for GitHub Pages to publish the site.

No build command is required.

### Cache-busting rule

When deploying a version that changes CSS, JavaScript, icons, or manifest references, bump all `?v=` query strings together.

Current version:

```text
8.6.1
```

The static test suite verifies that cache-busting versions stay aligned.

## Browser and device behavior

### Desktop

- Filter panel is available as a sidebar.
- The denser list view is used automatically (no display-mode control).
- Sticky result summary remains visible during exploration.

### Mobile

- The app always renders cards automatically.
- Filters open in a dialog-style panel.
- The panel can be closed through the close button, backdrop behavior, or `Escape` in browser tests.
- Selection button is compact and positioned at the top-right of cards.

## Persistence model

The app uses `localStorage` for:

- temporary movie selection.

The layout is derived from the viewport and is not persisted. The storage guard performs a real write/remove probe. If `localStorage` is unavailable or blocked, the app still works, but the persisted selection may not survive reloads.

No server-side persistence is used.

## Maintenance notes

### Test hooks

`script.js` exposes `window.__MovieExplorerTestHooks` for test access. This keeps the app dependency-free while allowing direct regression tests against parsing, sorting, filtering, selection, and rendering helpers.

### Column aliases

When adding a new data source, prefer updating `columnAliases` rather than changing the parsing pipeline.

### Rendering helpers

Card and list rendering share helper functions for title, metadata, genres, credits, and selection controls. When changing card content, check both display modes and selection detail rendering.

### Selection panel behavior

Selection detail expansion is tied to selected movie IDs, not to the currently filtered result grid. A selected movie can remain expandable even when active filters hide it from the main result list.

### Option-count cache

Filter option counts use a conservative cache key. This favors correctness over maximum cache reuse. Optimize only if count recalculation becomes visibly slow on a larger library.

## Known limitations

- The app depends on the published CSV being reachable from the browser.
- The UI is currently French-only.
- Runtime parsing treats bare numbers as minutes.
- Persisted selection is less stable when no URL/IMDb column exists.
- Poster display depends on direct image URLs; pages that contain an image are not the same as image-file URLs.
- The browser E2E layer requires a local Chromium installation.
- There is no backend, account system, or cross-device synchronization.
