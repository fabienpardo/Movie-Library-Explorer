#!/usr/bin/env node
const assert = require("node:assert/strict");
const { createTestRegistry, runTests } = require("./helpers/test-runner");
const {
  loadAppHooks,
  loadFixtureState,
  resetState,
  readFixtureCsv,
  list
} = require("./helpers/app-hooks");

const { tests, test } = createTestRegistry();

test("fixture CSV parses into the expected library rows", async () => {
  const h = await loadAppHooks();
  const fixture = readFixtureCsv();
  const { labels, rows } = h.csvToTable(fixture);

  assert.equal(rows.length, 511);
  assert.ok(labels.includes("Title"));
  assert.equal(rows[0].Title, "60 secondes chrono");
});

test("fixed column map matches every header in the fixture", async () => {
  const h = await loadAppHooks();
  const { labels } = h.csvToTable(readFixtureCsv());

  // Columns are mapped by fixed name (no fuzzy detection): guard that every mapped
  // name actually exists in the sheet header so a header rename can't go unnoticed.
  for (const name of Object.values(h.COLUMNS)) {
    assert.ok(labels.includes(name), `fixture header should contain "${name}"`);
  }
  assert.equal(h.COLUMNS.title, "Title");
  assert.equal(h.COLUMNS.originalTitle, "Original Title");
  assert.equal(h.COLUMNS.url, "URL");
  assert.equal(h.COLUMNS.poster, "Poster");
  assert.equal(h.COLUMNS.imdbRating, "IMDb Rating");
  assert.equal(h.COLUMNS.runtime, "Runtime (mins)");
  assert.equal(h.COLUMNS.actors, "Main actors");
  assert.equal(h.COLUMNS.saga, "Saga name");
  assert.equal(h.COLUMNS.sagaOrder, "Saga order");
});

test("saga totals derive from the highest order within each saga", async () => {
  const { h, rows } = await loadFixtureState();

  const endgame = rows.find(row => row.Title === "Avengers: Endgame");
  assert.equal(h.sagaName(endgame), "Avengers");
  assert.equal(h.sagaOrder(endgame), 4);
  assert.equal(h.sagaTotal(endgame), 4);

  const firstAvenger = rows.find(row => row.Title === "Avengers");
  assert.equal(h.sagaOrder(firstAvenger), 1);
  // Total is shared across the saga: order 1 of 4, not 1 of 1.
  assert.equal(h.sagaTotal(firstAvenger), 4);

  const standalone = rows.find(row => row.Title === "60 secondes chrono");
  assert.equal(h.sagaName(standalone), "");
  assert.equal(h.sagaOrder(standalone), null);
  assert.equal(h.sagaTotal(standalone), 0);
});

test("default position-desc sorting keeps the newest library positions first", async () => {
  const { h, rows } = await loadFixtureState();

  h.state.sort = "position-desc";
  const sorted = h.sortRows(rows);
  const maxPosition = Math.max(...rows.map(row => h.parseNumber(row.Position)).filter(Number.isFinite));

  assert.equal(h.parseNumber(sorted[0].Position), maxPosition);
});

test("title and duplicate-title normalization handle articles, accents and edge punctuation", async () => {
  const h = await loadAppHooks();

  assert.equal(h.sortableTitle("L’armée des ombres"), h.sortableTitle("armée des ombres"));
  assert.equal(h.sortableTitle("(The Matrix)"), h.sortableTitle("Matrix"));
  assert.equal(h.equivalentTitle("36 Quai des Orfèvres"), h.equivalentTitle("36 quai des orfevres"));
});

test("normalized original title is hidden when it duplicates the displayed title", async () => {
  const { h, rows } = await loadFixtureState();

  const row = rows.find(item => item.Title === "Les Petits Mouchoirs");
  assert.ok(row, "fixture row should exist");
  assert.equal(h.displayOriginalTitle(row), "");
});

test("year sorting uses Release Date before Year fallback", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "Year", "Release Date", "Position"];
  const rows = [
    { Title: "Older same-year release", Year: "2020", "Release Date": "2020-01-15", Position: "1" },
    { Title: "Newer same-year release", Year: "2020", "Release Date": "2020-12-31", Position: "2" },
    { Title: "Fallback year only", Year: "2021", "Release Date": "", Position: "3" }
  ];
  const columns = h.COLUMNS;
  resetState(h, labels, rows, columns);

  h.state.sort = "year-desc";
  const sorted = Array.from(h.sortRows(rows), row => row.Title);

  assert.deepEqual(sorted, ["Fallback year only", "Newer same-year release", "Older same-year release"]);
});

test("all-vs-any genre filtering behaves differently and preserves selected zero-count options", async () => {
  const { h } = await loadFixtureState();

  h.state.selected.genre = new Set(["Action", "Thriller"]);
  h.state.matchMode.genre = "all";
  const allMatches = h.filteredRows();
  assert.ok(allMatches.length > 0);
  assert.ok(allMatches.every(row => ["Action", "Thriller"].every(value => list(row, "Genres").includes(value))));

  h.state.matchMode.genre = "any";
  const anyMatches = h.filteredRows();
  assert.ok(anyMatches.length >= allMatches.length);

  h.state.selected.genre.add("__Missing regression genre__");
  const counts = h.baseOptionCounts("genre");
  assert.ok(counts.some(([value, count]) => value === "__Missing regression genre__" && count === 0));
});

test("filter option counts are sorted by descending count", async () => {
  const { h } = await loadFixtureState();

  const counts = h.baseOptionCounts("genre");
  assert.ok(counts.length > 0);
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index - 1][1] >= counts[index][1], `${counts[index - 1][0]} should be >= ${counts[index][0]}`);
  }
});

test("runtime, rating and IMDb URL helpers handle fixture values", async () => {
  const { h, rows } = await loadFixtureState();

  const first = rows[0];
  assert.equal(h.parseRuntime(first["Runtime (mins)"]), 118);
  assert.equal(h.formatRuntime(118), "1 h 58");
  assert.equal(h.ratingClass("8.0"), "meta-badge--rating-good");
  assert.equal(h.ratingClass("7.1"), "meta-badge--rating-mid");
  assert.equal(h.ratingClass("6.5"), "meta-badge--rating-low");
  assert.equal(h.movieUrl(first), "https://www.imdb.com/title/tt0187078/");
  assert.match(h.posterUrl(first), /^https:\/\//);
});


test("poster URLs are sanitized for card rendering", async () => {
  const h = await loadAppHooks();

  assert.equal(h.safeImageUrl("https://image.tmdb.org/t/p/w342/example.jpg"), "https://image.tmdb.org/t/p/w342/example.jpg");
  assert.match(h.safeImageUrl("data:image/png;base64,iVBORw0KGgo="), /^data:image\/png;base64,/);
  assert.equal(h.safeImageUrl("javascript:alert(1)"), "");
});

test("movie IDs prefer stable IMDb URLs before normalized fallback IDs", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "Original Title", "Year", "URL", "Position"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "A Film", "Original Title": "A Film", Year: "2020", URL: "https://www.imdb.com/title/tt1234567/", Position: "1" },
    { Title: "L’étrange film", "Original Title": "", Year: "2021", URL: "", Position: "2" }
  ];
  resetState(h, labels, rows, columns);

  assert.equal(h.makeMovieId(rows[0], 0, columns), "url:https://www.imdb.com/title/tt1234567/");
  assert.match(h.makeMovieId(rows[1], 1, columns), /^fallback:l etrange film:2021:2$/);
  assert.equal(JSON.stringify(h.legacyMovieIds(rows[0], 0, columns)), JSON.stringify(["https://www.imdb.com/title/tt1234567/", "movie:a film a film:2020:1"]));
});

test("temporary selection state is independent from filters", async () => {
  const h = await loadAppHooks();
  const { labels, rows } = h.csvToTable(readFixtureCsv());
  const columns = h.COLUMNS;
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);

  const id = h.movieId(preparedRows[0]);
  h.state.selection.add(id);
  h.state.search = "matrix";

  assert.equal(h.state.selection.has(id), true);
  assert.equal(h.selectedRows().length, 1);
  assert.ok(h.filteredRows().length > 0);
});

test("persisted selection IDs absent from the reloaded dataset are pruned", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "Year", "URL", "Position"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "A Film", Year: "2020", URL: "https://www.imdb.com/title/tt1234567/", Position: "1" }
  ];
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);
  // One ID still exists in the dataset; the other points at a removed movie.
  h.state.selection = new Set([
    "url:https://www.imdb.com/title/tt1234567/",
    "url:https://www.imdb.com/title/tt9999999/"
  ]);

  h.reconcilePersistedSelection(preparedRows, columns);

  assert.equal(h.state.selection.size, 1);
  assert.ok(h.state.selection.has("url:https://www.imdb.com/title/tt1234567/"));
  assert.ok(!h.state.selection.has("url:https://www.imdb.com/title/tt9999999/"));
  assert.equal(h.selectedRows().length, 1);
});

test("search filtering matches across fields and memoizes per-row search text", async () => {
  const h = await loadAppHooks();
  const { labels, rows } = h.csvToTable(readFixtureCsv());
  const columns = h.COLUMNS;
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);

  h.state.search = "__no_such_movie_term__";
  assert.equal(h.filteredRows().length, 0);

  h.state.search = "matrix";
  const matches = h.filteredRows().length;
  assert.ok(matches > 0);
  // Second pass exercises the cached __searchText and must return identical results.
  assert.equal(h.filteredRows().length, matches);
  assert.ok(preparedRows.every(row => typeof row.__searchText === "string"));
});

test("search is scoped to fixed metadata fields and ignores other columns", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "URL", "Notes"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "Alpha", URL: "https://www.imdb.com/title/tt1/", Notes: "zzqqxx synopsis token" }
  ];
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);

  // A searchable metadata field (title) matches.
  h.state.search = "alpha";
  assert.equal(h.filteredRows().length, 1);

  // Free-text columns outside SEARCH_FIELDS (e.g. Notes) and URL tokens must not be searchable.
  h.state.search = "zzqqxx";
  assert.equal(h.filteredRows().length, 0);
  h.state.search = "imdb.com";
  assert.equal(h.filteredRows().length, 0);

  // Guard the allow-list itself so the intent stays explicit.
  assert.ok(!h.SEARCH_FIELDS.includes("notes"));
  assert.ok(h.SEARCH_FIELDS.includes("title"));
});

test("legacy persisted movie IDs are reconciled to the explicit v8.4.2 ID format", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "Year", "URL", "Position"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "A Film", Year: "2020", URL: "https://www.imdb.com/title/tt1234567/", Position: "1" },
    { Title: "Fallback Film", Year: "2021", URL: "", Position: "2" }
  ];
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);
  h.state.selection = new Set(["https://www.imdb.com/title/tt1234567/", "movie:fallback film:2021:2"]);

  h.reconcilePersistedSelection(preparedRows, columns);

  assert.equal(JSON.stringify([...h.state.selection].sort()), JSON.stringify([
    "fallback:fallback film:2021:2",
    "url:https://www.imdb.com/title/tt1234567/"
  ].sort()));
});

test("safe DOM IDs are deterministic and do not need HTML escaping first", async () => {
  const h = await loadAppHooks();

  assert.equal(h.toSafeDomId('url:https://example.com/title/<tt1>&x="1"', 'selection-detail'), 'selection-detail-url-https-example-com-title-tt1-x-1');
});

test("search matches real cell values only and ignores the synthetic movie ID", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "URL", "Position"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "Le Voyage", URL: "https://www.imdb.com/title/tt0187078/", Position: "1" },
    { Title: "Mon Film", URL: "", Position: "2" }
  ];
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);

  // "fallback" only appears in the synthetic id of the URL-less row, never in a real cell.
  h.state.search = "fallback";
  assert.equal(h.filteredRows().length, 0);

  // A term that lives only in the synthetic id prefix of the URL-backed row must not match either.
  h.state.search = "url";
  assert.equal(h.filteredRows().length, 0);

  // Real user-facing values still match, but hidden URL-only terms do not.
  h.state.search = "voyage";
  assert.deepEqual(h.filteredRows().map(row => row.Title), ["Le Voyage"]);
  h.state.search = "tt0187078";
  assert.equal(h.filteredRows().length, 0);
});

test("escapeHtml neutralizes HTML metacharacters for non-DOM string contexts", async () => {
  const h = await loadAppHooks();

  // Live rendering now uses DOM node creation and textContent for user/CSV-derived values.
  // escapeHtml is kept for the few non-live string contexts and testable formatting helpers.
  assert.equal(h.escapeHtml(`<script>alert("x")&'`), "&lt;script&gt;alert(&quot;x&quot;)&amp;&#039;");
  assert.equal(h.escapeHtml(null), "");
  assert.equal(h.escapeHtml(undefined), "");
  assert.equal(h.escapeHtml(42), "42");
});

test("parseCsv handles quoted delimiters, escaped quotes, embedded newlines, CRLF and blank lines", async () => {
  const h = await loadAppHooks();

  // Rehydrate into test-realm arrays so deepEqual's prototype check passes across the vm boundary.
  const rows = Array.from(h.parseCsv('a,"b,c","d""e"\r\n"multi\nline",f,g\r\n   \r\nx,y,z'), row => [...row]);
  assert.equal(rows.length, 3, "all-whitespace lines are dropped");
  assert.deepEqual(rows[0], ["a", "b,c", 'd"e']);
  assert.deepEqual(rows[1], ["multi\nline", "f", "g"]);
  assert.deepEqual(rows[2], ["x", "y", "z"]);

  // parseCsv keeps a leading BOM verbatim; csvToTable is the layer that strips it from headers.
  assert.equal(h.parseCsv("﻿Title,Year\nFilm,2020")[0][0], "﻿Title");
  assert.equal(h.csvToTable("﻿Title,Year\nFilm,2020").labels[0], "Title");
});

test("parseRuntime and parseDateValue cover every supported input shape", async () => {
  const h = await loadAppHooks();

  assert.equal(h.parseRuntime("118"), 118);
  assert.equal(h.parseRuntime("1h30"), 90);
  assert.equal(h.parseRuntime("2h"), 120);
  assert.equal(h.parseRuntime("2:05"), 125);
  assert.equal(h.parseRuntime("95 min"), 95);
  assert.equal(h.parseRuntime(140), 140);
  assert.ok(Number.isNaN(h.parseRuntime("")));

  assert.equal(h.parseDateValue("2020-03-15"), Date.UTC(2020, 2, 15));
  assert.equal(h.parseDateValue("15/03/2020"), Date.UTC(2020, 2, 15));
  assert.equal(h.parseDateValue("15.03.2020"), Date.UTC(2020, 2, 15));
  assert.ok(Number.isNaN(h.parseDateValue("")));
  assert.ok(Number.isNaN(h.parseDateValue("not a date")));
});

test("baseOptionCounts memoizes per input state and recomputes when filters change", async () => {
  const { h } = await loadFixtureState();

  const first = h.baseOptionCounts("genre");
  const second = h.baseOptionCounts("genre");
  assert.strictEqual(second, first, "identical state should return the cached array reference");
  assert.ok(h.state.optionCountsCache.size >= 1);

  h.state.selected.genre.add("Action");
  const third = h.baseOptionCounts("genre");
  assert.notStrictEqual(third, first, "changing the selection must bust the cache key");
});

test("baseOptionCounts cache includes saga filter state", async () => {
  const { h } = await loadFixtureState();

  const fullActorCounts = h.baseOptionCounts("actor");
  h.state.selected.saga.add("La Trilogie marseillaise");
  const sagaActorCounts = h.baseOptionCounts("actor");

  assert.notStrictEqual(sagaActorCounts, fullActorCounts, "changing saga selection must bust the cache key");
  assert.equal(
    JSON.stringify(sagaActorCounts.slice(0, 2)),
    JSON.stringify([["Pierre Fresnay", 3], ["Raimu", 3]])
  );
  assert.ok(!sagaActorCounts.some(([value, count]) => value === "Tom Cruise" && count > 3));
});

test("baseOptionCounts cache is bounded", async () => {
  const h = await loadAppHooks();
  const labels = ["Title", "Genres", "Main actors", "Directors"];
  const columns = h.COLUMNS;
  const rows = [
    { Title: "A", Genres: "Drama", "Main actors": "Actor A", Directors: "Director A" },
    { Title: "B", Genres: "Comedy", "Main actors": "Actor B", Directors: "Director B" }
  ];
  resetState(h, labels, rows, columns);

  for (let i = 0; i < 120; i += 1) {
    h.state.search = `term-${i}`;
    h.baseOptionCounts("actor");
  }

  assert.ok(h.state.optionCountsCache.size <= 80);
});

runTests(tests, { label: 'regression scenarios' });
