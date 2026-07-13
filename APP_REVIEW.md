# Full application review

Date: 2026-07-14  
Reviewed version: 8.8.11  
Branch: main

## Executive summary

The application is functionally healthy on its current production data source, and all existing automated checks pass. No critical remote exploit or current-dataset correctness failure was found.

The review is not clean, however. Four areas should be addressed before calling the app production-hardened:

1. Keyboard focus is lost during common filter and selection actions.
2. Mobile dialogs do not fully isolate background content.
3. Service-worker recovery can discard or poison the last valid CSV.
4. The card reuse strategy retains excessive detached DOM and repeatedly rebuilds unchanged cards.

## Findings

### 1. High — Filter and selection actions lose keyboard focus

Filter changes trigger a complete render and replace the focused checkbox. Card filter actions replace the card body, while active-filter and selection removal rebuild their containers. Chromium checks confirmed that these actions can leave document focus on the body. Removing an item from the still-open selection dialog can also leave focus outside the modal.

This makes keyboard and screen-reader navigation restart from an unrelated location.

Evidence:

- [src/app.mjs](src/app.mjs#L188)
- [src/app.mjs](src/app.mjs#L278)
- [src/render-filters.mjs](src/render-filters.mjs#L51)
- [src/render-cards.mjs](src/render-cards.mjs#L158)
- [src/selection.mjs](src/selection.mjs#L38)

Recommended fix:

- Preserve controls through keyed reconciliation where practical.
- Otherwise capture a stable focus key before rendering and restore the same or next logical control afterward.
- After deleting an item from a dialog, explicitly focus the next item, the previous item, or a safe dialog control.
- Add keyboard E2E tests using real Space and Enter activation.

### 2. High — The mobile filter modal leaves the header interactive

The sticky header and filter panel both use z-index 30, while the filter backdrop uses z-index 20. At 390 × 844, the global search field remained clickable and could receive focus while the filter dialog was open.

The filter and selection implementations set aria-modal on the open panel but do not make the rest of the application inert. The selection backdrop blocks pointer interaction, but its background remains exposed in the accessibility tree.

Evidence:

- [style.css](style.css#L132)
- [style.css](style.css#L395)
- [src/filter-panel.mjs](src/filter-panel.mjs#L43)
- [src/selection.mjs](src/selection.mjs#L62)

Recommended fix:

- Prefer a native dialog opened with showModal, or inert all non-dialog application regions while a panel is open.
- Place the filter backdrop and panel above the sticky header.
- Verify pointer, keyboard, and accessibility-tree isolation.

### 3. High — Invalid Google responses can poison offline data

The service worker falls back to cached CSV only when fetch throws. A Google 429 or 5xx response is returned directly even when a valid cached response exists.

The worker also caches every successful HTTP response before the application checks whether the body is HTML. A status-200 login, quota, or error page can therefore replace the last valid CSV and break subsequent offline recovery.

Cache writes at several paths are neither awaited nor attached to the fetch-event lifetime, so the worker can terminate before persistence completes.

Evidence:

- [sw.js](sw.js#L104)
- [sw.js](sw.js#L127)
- [sw.js](sw.js#L147)
- [src/app.mjs](src/app.mjs#L114)

Recommended fix:

- Treat non-2xx responses as failures eligible for cached fallback.
- Validate content type and CSV content before replacing the cache.
- Await cache writes or protect them with event.waitUntil.
- Keep cache-write failures isolated so a valid network response still reaches the application.

### 4. Medium/high — App updates delete the working offline dataset too early

The data cache is versioned with the application. During activation, the new worker deletes every previous versioned data cache before a replacement CSV has been fetched and validated.

If Google Sheets is unavailable during the controller-change reload, the newly updated app has no last-known-good dataset even though the previous version was offline-capable.

Evidence:

- [sw.js](sw.js#L8)
- [sw.js](sw.js#L49)

Recommended fix:

- Use a stable data-cache name independent of the shell version, or preserve the previous data cache until a validated replacement has been stored.

### 5. Medium/high — The card reuse strategy retains the entire library

The detached-card cache allows 800 entries, exceeding the current 523-film live library. Detached cards deliberately retain their DOM and image nodes.

A Chrome memory probe loaded the 511-row fixture, filtered to zero, and forced garbage collection. Only 148 nodes remained connected, while the browser still reported 35,621 DOM nodes. Images were disabled during this probe, so the result excludes real poster decode and GPU pressure.

Evidence:

- [src/config.mjs](src/config.mjs#L46)
- [src/state.mjs](src/state.mjs#L10)
- [src/render-cards.mjs](src/render-cards.mjs#L64)
- [src/render-cards.mjs](src/render-cards.mjs#L113)

Recommended fix:

- Limit the detached pool to approximately one or two visible batches.
- Clear image sources when evicting cached cards.
- Add a detached-node or heap regression budget.
- Consider windowing if rendering the entire library remains a supported workflow.

### 6. Medium/high — Load More rebuilds every existing card body

Every render calls updateCardContent for every live card, even when the row and card content have not changed. Repeated Load More actions therefore rebuild all prior card bodies before appending the next batch.

With the 511-row fixture, repeated loading produced 167,394 allocated DOM nodes for roughly 24,296 connected nodes before collection. Once many cards are visible, sorting or filtering also performs unnecessary work across the full displayed set.

Evidence:

- [src/render-cards.mjs](src/render-cards.mjs#L100)
- [src/render-cards.mjs](src/render-cards.mjs#L158)
- [src/app.mjs](src/app.mjs#L317)

Recommended fix:

- Skip body reconstruction when the row signature and relevant UI state are unchanged.
- Make Load More append only newly visible cards.
- Add a full-fixture performance scenario.

### 7. Medium — Concurrent reload requests can commit out of order

Every reload click starts an independent fetch and every completion mutates shared global state.

If request B succeeds and an older request A later fails, A clears B's valid rows, filters, and cards. An older successful response can likewise overwrite newer data. A stalled request also leaves the interface loading indefinitely.

Evidence:

- [src/app.mjs](src/app.mjs#L106)
- [src/app.mjs](src/app.mjs#L321)

Recommended fix:

- Abort the previous request.
- Track a monotonically increasing request generation.
- Commit success or failure only for the latest request.
- Add a timeout and test out-of-order resolution.

### 8. Medium — Non-Latin and punctuation-only searches match every movie

The normalization function removes everything outside ASCII letters and digits. Queries such as 東京, 기생충, !!!, or emoji normalize to an empty string. Every row then matches because every string contains an empty substring.

The same normalization can collapse non-Latin fallback movie titles to untitled, increasing ID collision risk.

Evidence:

- [src/utils.mjs](src/utils.mjs#L15)
- [src/matching.mjs](src/matching.mjs#L22)
- [src/data.mjs](src/data.mjs#L67)

Recommended fix:

- Preserve Unicode letters and numbers with Unicode property escapes.
- Ensure a non-empty raw query whose normalized form is empty cannot become a match-all query.
- Add non-Latin, punctuation-only, whitespace-only, and emoji regression cases.

### 9. Medium — Important card actions are undersized for touch

At a 390px viewport, measured control heights were:

| Control | Measured height |
|---|---:|
| Actor/director filter button | 15.6px |
| Genre filter button | 19.5px |
| Saga filter button | 23.5px |
| Selection button | 34px |

Adjacent credit targets are particularly difficult to activate and fall below a 24px target-plus-spacing baseline.

Evidence:

- [style.css](style.css#L975)
- [style.css](style.css#L1165)
- [style.css](style.css#L1187)
- [style.css](style.css#L1431)

Recommended fix:

- Provide approximately 44px coarse-pointer hit areas where possible.
- At minimum, satisfy a 24px target with sufficient spacing.

### 10. Medium — Credit headings fail text contrast

The card-local faint color is #5a5248 on #161210, approximately 2.42:1 contrast. It is used for the 9px Réalisation and Acteurs labels, well below the normal-text contrast requirement and difficult to read even without visual impairment.

Evidence:

- [style.css](style.css#L915)
- [style.css](style.css#L1148)

Recommended fix:

- Use the existing higher-contrast faint or muted token.
- Raise the label size to at least 11–12px.

### 11. Medium — Repeated controls have indistinguishable accessible names

Every movie selection button is named only Ajouter à la sélection or Retirer de la sélection. Active-filter removal buttons omit the filter value, so multiple buttons may all be announced as Retirer le filtre Genre or Retirer le filtre Acteur.

Evidence:

- [src/render-cards.mjs](src/render-cards.mjs#L143)
- [src/render-cards.mjs](src/render-cards.mjs#L221)
- [src/render-filters.mjs](src/render-filters.mjs#L130)

Recommended fix:

- Include the movie title in selection-button names.
- Include both the filter group and value in removal-button names.

### 12. Medium — Movie IDs are not validated for uniqueness

Two rows sharing the same IMDb URL receive the same ID. Fallback IDs can also collide on title, year, and position.

The keyed renderer then collapses entries in a Map. Because a reused card refreshes only its body, one row's title or poster can be combined with another row's metadata. Selection also treats colliding rows as one item.

The current 511-row fixture contains no duplicate IDs, so this is a latent ingestion defect rather than a current-data failure.

Evidence:

- [src/data.mjs](src/data.mjs#L67)
- [src/data.mjs](src/data.mjs#L88)
- [src/render-cards.mjs](src/render-cards.mjs#L89)
- [src/selection.mjs](src/selection.mjs#L10)

Recommended fix:

- Validate uniqueness during ingestion.
- Reject and diagnose duplicate IDs, or append a deterministic disambiguator.

### 13. Medium — Production startup and offline behavior are not exercised by E2E

The browser harness removes the real entry script and stylesheet link, blocks all HTTP and HTTPS requests, injects a fake fetch, and imports rewritten Blob modules. It therefore does not exercise:

- The production script entry point.
- Real module paths.
- Service-worker registration and installation.
- Cache migration and offline behavior.
- Live CSV availability.
- Real poster loading.

Missing Chromium can also become a successful test skip. A production module-import failure currently logs to the console but leaves users permanently on the initial loading message.

Evidence:

- [tests/browser-test-utils.js](tests/browser-test-utils.js#L205)
- [tests/browser-test-utils.js](tests/browser-test-utils.js#L224)
- [tests/browser-test-utils.js](tests/browser-test-utils.js#L247)
- [tests/helpers/browser-runner.js](tests/helpers/browser-runner.js#L34)
- [script.js](script.js#L6)
- [index.html](index.html#L165)

Recommended fix:

- Add a localhost smoke test using the unmodified index, entry script, static module URLs, and service worker.
- Add service-worker behavior tests for invalid CSV, 5xx fallback, quota errors, cache migration, and offline updates.
- Make browser absence fail in CI unless an explicit local skip flag is set.
- Render a fatal startup message with retry guidance when bootstrapping fails.

### 14. Medium — Lint and coverage execute unpinned packages

Lint and coverage use npx --yes without pinned development dependencies or a lockfile. Results depend on the latest package versions and require network access while executing newly downloaded code.

Coverage also runs only the unit regression suite and has no threshold.

Evidence:

- [package.json](package.json#L11)

Recommended fix:

- Pin ESLint and c8 in devDependencies.
- Commit a lockfile and use npm ci.
- Add coverage thresholds.
- Run tests and lint in a tracked CI workflow.

### 15. Conditional high — The complete dataset is public, not only displayed columns

The application consumes a published whole-sheet CSV. The tracked 511-row fixture contains unused columns including Your Rating, and production accepts ?fixture=1 to load that snapshot. A repository-root GitHub Pages deployment also makes the fixture directly downloadable.

This is acceptable only if every current column, historical row, and personal rating is intentionally public.

Evidence:

- [src/config.mjs](src/config.mjs#L1)
- [src/app.mjs](src/app.mjs#L52)
- [tests/fixtures/apple-tv-movies-library-mdb.csv](tests/fixtures/apple-tv-movies-library-mdb.csv#L1)
- [README.md](README.md#L190)

Recommended fix if any data is sensitive:

- Publish a sanitized sheet or tab containing only required columns.
- Replace the real-library fixture with synthetic data.
- Deploy a whitelisted artifact that excludes tests and test hooks.
- If sensitive data has already been published, unpublish the source and assess repository-history cleanup.

## Additional technical debt

### Service-worker poster failures are not fail-open

A quota rejection during cache.put can reject an otherwise valid poster response. The broad image branch also has no explicit HTTP or HTTPS protocol guard.

- [sw.js](sw.js#L67)
- [sw.js](sw.js#L79)

### Reduced-motion support is incomplete

The selection panel disables its transition for reduced motion, but the filter sheet does not. Search focus and back-to-top also force smooth scrolling.

- [style.css](style.css#L402)
- [style.css](style.css#L1632)
- [src/filter-panel.mjs](src/filter-panel.mjs#L91)
- [src/filter-panel.mjs](src/filter-panel.mjs#L113)

### Horizontal safe areas are omitted

The app opts into viewport-fit=cover, but the bottom sheet and selection drawer do not include left and right safe-area padding for landscape notches.

- [index.html](index.html#L5)
- [style.css](style.css#L402)
- [style.css](style.css#L1241)

### Duplicate list values inflate filter counts

A cell containing Drama, Drama increments the count twice for one movie. Counts should iterate over a per-row Set, and card tokens should preferably be deduplicated too.

- [src/utils.mjs](src/utils.mjs#L19)
- [src/matching.mjs](src/matching.mjs#L76)

### Filter reset leaves panel state inconsistent

Resetting filters sets state.activePanel to genre but does not call setActivePanel. If the Actor or Saga panel is visible, the DOM remains on that panel while state reports Genre.

- [src/app.mjs](src/app.mjs#L79)
- [src/app.mjs](src/app.mjs#L211)
- [src/filter-panel.mjs](src/filter-panel.mjs#L4)

### Stale CSS rules remain

The media card establishes display: block, but later responsive rules still assign obsolete grid columns and leak padding differences into poster cards. Repeated header and duplicate breakpoint blocks make the cascade harder to reason about.

- [style.css](style.css#L915)
- [style.css](style.css#L1589)

### Product and documentation wording has drifted

- Sélection temporaire persists indefinitely in localStorage.
- The manifest omits lang: fr.
- README test totals say 12 static and 16 browser scenarios; current totals are 13 and 17.

Evidence:

- [src/selection.mjs](src/selection.mjs#L180)
- [src/state.mjs](src/state.mjs#L79)
- [manifest.webmanifest](manifest.webmanifest#L1)
- [README.md](README.md#L182)

## Positive risk assessment

- No direct HTML-injection path was found in live rendering. Dynamic content is built with DOM APIs and textContent.
- Movie and poster URLs are restricted to HTTP and HTTPS, with safe raster-image data URLs allowed for posters.
- External movie links use noopener and noreferrer.
- The current fixture has no duplicate movie IDs, duplicate URLs, non-Latin title rows, or duplicate list tokens.
- The 13 source modules form an acyclic import graph.
- The live production route loaded successfully with no diagnostics or console errors.

## Verification performed

- Live production route: 523 films loaded.
- Initial rendered batch: 40 films.
- Desktop review: 1280px viewport.
- Mobile review: 390 × 844.
- Narrow mobile review: 320 × 568.
- Horizontal overflow: none at tested widths.
- Unit regression suite: 27/27 passed.
- Static asset suite: 13/13 passed.
- Browser E2E suite: 17/17 passed.
- Test-runner self-check: passed.
- Module graph check: passed.
- ESLint: passed.
- Worktree after review: clean on main, aligned with origin/main.

## Recommended implementation order

1. Preserve focus and fully isolate both modal panels.
2. Make CSV caching validation-first, stable across app versions, and fail-safe.
3. Reduce the detached-card pool and stop rebuilding unchanged card bodies.
4. Add reload cancellation and latest-request protection.
5. Fix Unicode search, target sizes, contrast, and accessible names.
6. Validate movie ID uniqueness during ingestion.
7. Add real-entry, service-worker, offline, and full-fixture performance tests.
8. Sanitize published data and deployment artifacts if any columns are not intended to be public.
