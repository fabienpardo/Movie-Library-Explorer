const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '..', '..');
const appModulePath = path.join(rootDir, 'src', 'test-hooks.mjs');
const fixturePath = path.join(rootDir, 'tests', 'fixtures', 'apple-tv-movies-library-mdb.csv');

async function loadAppHooks() {
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
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    setTimeout,
    clearTimeout,
    scrollTo() {}
  };

  global.window = window;
  global.document = {};
  global.HTMLElement = HTMLElement;
  global.requestAnimationFrame = window.requestAnimationFrame;

  const moduleUrl = `${pathToFileURL(appModulePath).href}?test=${Date.now()}-${Math.random()}`;
  const app = await import(moduleUrl);
  return app.installTestHooks(window);
}

function resetState(hooks, labels, rows, columns) {
  Object.assign(hooks.state, {
    rows,
    labels,
    columns,
    warnings: [],
    search: '',
    sort: 'position-desc',
    filterSearch: { actor: '', director: '' },
    matchMode: { genre: 'all', actor: 'all', director: 'all' },
    selected: { genre: new Set(), actor: new Set(), director: new Set(), saga: new Set() },
    selection: new Set(),
    selectionPanelOpen: false,
    selectionDetailId: '',
    activePanel: 'genre',
    filtersOpen: false,
    lastFocus: null,
    backToTopVisible: null,
    optionCountsCache: new Map()
  });
}

function readFixtureCsv() {
  return fs.readFileSync(fixturePath, 'utf8');
}

async function loadFixtureState() {
  const h = await loadAppHooks();
  const { labels, rows } = h.csvToTable(readFixtureCsv());
  const { columns } = h.detectColumns(labels);
  resetState(h, labels, rows, columns);
  return { h, labels, rows, columns };
}

function list(row, columnName) {
  return String(row[columnName] || '').split(/[,;|]/).map(item => item.trim()).filter(Boolean);
}

module.exports = {
  rootDir,
  fixturePath,
  loadAppHooks,
  loadFixtureState,
  resetState,
  readFixtureCsv,
  list
};
