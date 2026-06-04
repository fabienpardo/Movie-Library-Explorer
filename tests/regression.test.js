#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const scriptPath = path.join(rootDir, "script.js");
const fixturePath = path.join(__dirname, "fixtures", "apple-tv-movies-library-mdb.csv");

function loadAppHooks() {
  function HTMLElement() {}
  HTMLElement.prototype = {};

  const window = {
    MOVIE_EXPLORER_SKIP_AUTO_INIT: true,
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        addListener() {},
        removeEventListener() {},
        removeListener() {}
      };
    },
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    setTimeout,
    scrollTo() {}
  };

  const context = {
    console,
    document: {},
    HTMLElement,
    window,
    URL,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return context.window.__MovieExplorerTestHooks;
}

function resetState(hooks, labels, rows, columns) {
  Object.assign(hooks.state, {
    rows,
    labels,
    columns,
    warnings: [],
    search: "",
    sort: "position-desc",
    viewMode: "cards",
    filterSearch: { actor: "", director: "" },
    matchMode: { genre: "all", actor: "all", director: "all" },
    selected: { genre: new Set(), actor: new Set(), director: new Set() },
    selection: new Set(),
    selectionPanelOpen: false,
    selectionDetailId: "",
    activePanel: "genre",
    filtersOpen: false,
    lastFocus: null,
    backToTopVisible: null,
    optionCountsCache: new Map()
  });
}

function list(row, columnName) {
  return String(row[columnName] || "").split(/[,;|]/).map(item => item.trim()).filter(Boolean);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("fixture CSV parses into the expected library rows", () => {
  const h = loadAppHooks();
  const fixture = fs.readFileSync(fixturePath, "utf8");
  const { labels, rows } = h.csvToTable(fixture);

  assert.equal(rows.length, 510);
  assert.ok(labels.includes("Title"));
  assert.equal(rows[0].Title, "60 secondes chrono");
});

test("uploaded fixture columns are detected by aliases", () => {
  const h = loadAppHooks();
  const { labels } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const detected = h.detectColumns(labels);

  assert.equal(detected.columns.title, "Title");
  assert.equal(detected.columns.originalTitle, "Original Title");
  assert.equal(detected.columns.url, "URL");
  assert.equal(detected.columns.imdbRating, "IMDb Rating");
  assert.equal(detected.columns.runtime, "Runtime (mins)");
  assert.equal(detected.columns.year, "Year");
  assert.equal(detected.columns.releaseDate, "Release Date");
  assert.equal(detected.columns.position, "Position");
  assert.equal(detected.columns.directors, "Directors");
  assert.equal(detected.columns.actors, "Main actors");
  assert.equal(detected.columns.country, "Country");
  assert.equal(detected.warnings.length, 0);
});

test("default position-desc sorting keeps the newest library positions first", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

  h.state.sort = "position-desc";
  const sorted = h.sortRows(rows);
  const maxPosition = Math.max(...rows.map(row => h.parseNumber(row.Position)).filter(Number.isFinite));

  assert.equal(h.parseNumber(sorted[0].Position), maxPosition);
});

test("title and duplicate-title normalization handle articles, accents and edge punctuation", () => {
  const h = loadAppHooks();

  assert.equal(h.sortableTitle("L’armée des ombres"), h.sortableTitle("armée des ombres"));
  assert.equal(h.sortableTitle("(The Matrix)"), h.sortableTitle("Matrix"));
  assert.equal(h.equivalentTitle("36 Quai des Orfèvres"), h.equivalentTitle("36 quai des orfevres"));
});

test("normalized original title is hidden when it duplicates the displayed title", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

  const row = rows.find(item => item.Title === "Les Petits Mouchoirs");
  assert.ok(row, "fixture row should exist");
  assert.equal(h.displayOriginalTitle(row), "");
});

test("year sorting uses Release Date before Year fallback", () => {
  const h = loadAppHooks();
  const labels = ["Title", "Year", "Release Date", "Position"];
  const rows = [
    { Title: "Older same-year release", Year: "2020", "Release Date": "2020-01-15", Position: "1" },
    { Title: "Newer same-year release", Year: "2020", "Release Date": "2020-12-31", Position: "2" },
    { Title: "Fallback year only", Year: "2021", "Release Date": "", Position: "3" }
  ];
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

  h.state.sort = "year-desc";
  const sorted = Array.from(h.sortRows(rows), row => row.Title);

  assert.deepEqual(sorted, ["Fallback year only", "Newer same-year release", "Older same-year release"]);
});

test("all-vs-any genre filtering behaves differently and preserves selected zero-count options", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

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

test("filter option counts are sorted by descending count", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

  const counts = h.baseOptionCounts("genre");
  assert.ok(counts.length > 0);
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index - 1][1] >= counts[index][1], `${counts[index - 1][0]} should be >= ${counts[index][0]}`);
  }
});

test("runtime, rating and IMDb URL helpers handle fixture values", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);

  const first = rows[0];
  assert.equal(h.parseRuntime(first["Runtime (mins)"]), 118);
  assert.equal(h.formatRuntime(118), "1 h 58");
  assert.equal(h.ratingClass("8.0"), "meta-badge--rating-good");
  assert.equal(h.ratingClass("7.1"), "meta-badge--rating-mid");
  assert.equal(h.ratingClass("6.5"), "meta-badge--rating-low");
  assert.equal(h.movieUrl(first), "https://www.imdb.com/title/tt0187078/");
});


test("movie IDs prefer stable IMDb URLs before normalized fallback IDs", () => {
  const h = loadAppHooks();
  const labels = ["Title", "Original Title", "Year", "URL", "Position"];
  const { columns } = h.detectColumns(labels);
  const rows = [
    { Title: "A Film", "Original Title": "A Film", Year: "2020", URL: "https://www.imdb.com/title/tt1234567/", Position: "1" },
    { Title: "L’étrange film", "Original Title": "", Year: "2021", URL: "", Position: "2" }
  ];
  resetState(h, labels, rows, columns);

  assert.equal(h.makeMovieId(rows[0], 0, columns), "url:https://www.imdb.com/title/tt1234567/");
  assert.match(h.makeMovieId(rows[1], 1, columns), /^fallback:l etrange film:2021:2$/);
  assert.equal(JSON.stringify(h.legacyMovieIds(rows[0], 0, columns)), JSON.stringify(["https://www.imdb.com/title/tt1234567/", "movie:a film a film:2020:1"]));
});

test("temporary selection state is independent from filters", () => {
  const h = loadAppHooks();
  const { labels, rows } = h.csvToTable(fs.readFileSync(fixturePath, "utf8"));
  const { columns } = h.detectColumns(labels);
  const preparedRows = rows.map((row, index) => ({ ...row, __movieExplorerId: h.makeMovieId(row, index, columns) }));
  resetState(h, labels, preparedRows, columns);

  const id = h.movieId(preparedRows[0]);
  h.state.selection.add(id);
  h.state.search = "matrix";

  assert.equal(h.state.selection.has(id), true);
  assert.equal(h.selectedRows().length, 1);
  assert.ok(h.filteredRows().length > 0);
});

test("missing URL columns emit a persistence-stability warning", () => {
  const h = loadAppHooks();
  const detected = h.detectColumns(["Title", "Year", "Position"]);

  assert.equal(detected.columns.url, null);
  assert.ok(detected.warnings.some(message => message.includes("Aucune colonne URL/IMDb")));
});

test("legacy persisted movie IDs are reconciled to the explicit v8.4.2 ID format", () => {
  const h = loadAppHooks();
  const labels = ["Title", "Year", "URL", "Position"];
  const { columns } = h.detectColumns(labels);
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

test("safe DOM IDs are deterministic and do not need HTML escaping first", () => {
  const h = loadAppHooks();

  assert.equal(h.toSafeDomId('url:https://example.com/title/<tt1>&x="1"', 'selection-detail'), 'selection-detail-url-https-example-com-title-tt1-x-1');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) console.log(`\n${passed}/${tests.length} regression scenarios passed.`);
