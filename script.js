const PUBLISHED_SHEET_ID = "2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK";
const GID = "70337195";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;
const TEST_FIXTURE_CSV_URL = "./tests/fixtures/apple-tv-movies-library-mdb.csv";
const TEST_MISSING_CSV_URL = "./tests/fixtures/__missing_regression_fixture__.csv";
const DESKTOP_QUERY = window.matchMedia("(min-width: 760px)");
const SUPPORTS_INERT = "inert" in HTMLElement.prototype;
const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
// Used by the inert fallback: includes controls even when they have already been forced to tabindex=-1.
const PANEL_FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

const columnAliases = {
  title: ["title", "movie", "movie title", "name"],
  originalTitle: ["original title", "originaltitle", "original name", "original movie title"],
  genres: ["genre", "genres"],
  runtime: ["runtime", "runtime min", "runtime mins", "runtime minutes", "duration", "duration min", "duration mins", "duration minutes", "running time"],
  year: ["year", "release year", "movie year"],
  releaseDate: ["release date", "released", "date released", "premiere date", "theatrical release", "release"],
  position: ["position", "library position", "library rank", "library order", "rank", "order"],
  imdbRating: ["imdb rating", "imdb", "imdb score", "imdb rate", "imdb user rating"],
  url: ["url", "link", "movie url", "imdb url", "imdb link", "imdb title url", "imdb page", "imdb title page"],
  poster: ["poster", "poster url", "poster link", "cover", "cover url", "cover link", "image", "image url", "image link", "affiche", "affiche url", "affiche link"],
  country: ["country", "countries", "production country", "production countries", "main country", "origin country", "country of origin", "nationality"],
  actors: ["actor", "actors", "cast", "main cast", "stars", "starring", "lead actors"],
  directors: ["director", "directors", "directed by"]
};

const categories = {
  genre: { label: "Genre", column: "genres", listId: "genreList", countId: "genreSelectedCount", empty: "Aucun genre disponible pour les filtres actuels" },
  actor: { label: "Acteur", column: "actors", listId: "actorList", countId: "actorSelectedCount", searchId: "actorFilterSearch", empty: "Aucun acteur disponible pour les filtres actuels" },
  director: { label: "Réalisateur", column: "directors", listId: "directorList", countId: "directorSelectedCount", searchId: "directorFilterSearch", empty: "Aucun réalisateur disponible pour les filtres actuels" }
};
const categoryKeys = Object.keys(categories);
const searchableCategories = categoryKeys.filter(category => categories[category].searchId);
const DEFAULT_MATCH_MODE = { genre: "all", actor: "all", director: "all" };
const VIEW_MODE_VALUES = new Set(["cards", "list"]);
const STORAGE_KEYS = {
  viewMode: "movieExplorer.viewMode",
  selection: "movieExplorer.selection"
};
let storageAvailabilityCache = null;

const els = {};
const state = {
  rows: [],
  labels: [],
  columns: {},
  warnings: [],
  search: "",
  sort: "position-desc",
  viewMode: "cards",
  filterSearch: { actor: "", director: "" },
  matchMode: { ...DEFAULT_MATCH_MODE },
  selected: { genre: new Set(), actor: new Set(), director: new Set() },
  selection: new Set(),
  selectionPanelOpen: false,
  selectionDetailId: "",
  activePanel: "genre",
  filtersOpen: false,
  lastFocus: null,
  backToTopVisible: null,
  optionCountsCache: new Map()
};

function byId(id) { return document.getElementById(id); }
function dataSourceUrl() {
  const fixtureMode = window.MOVIE_EXPLORER_TEST_FIXTURE_MODE || new URLSearchParams(window.location.search).get("fixture");
  if (fixtureMode === "1") return TEST_FIXTURE_CSV_URL;
  if (fixtureMode === "missing") return TEST_MISSING_CSV_URL;
  return SHEET_CSV_URL;
}
function storageAvailable() {
  if (storageAvailabilityCache !== null) return storageAvailabilityCache;
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      storageAvailabilityCache = false;
      return storageAvailabilityCache;
    }

    const probeKey = "movieExplorer.storageProbe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    storageAvailabilityCache = true;
    return storageAvailabilityCache;
  } catch {
    storageAvailabilityCache = false;
    return storageAvailabilityCache;
  }
}
function resetStorageAvailabilityForTests() {
  storageAvailabilityCache = null;
}
function readStoredValue(key) {
  if (!storageAvailable()) return null;
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}
function writeStoredValue(key, value) {
  if (!storageAvailable()) return;
  try { window.localStorage.setItem(key, value); }
  catch {}
}
function removeStoredValue(key) {
  if (!storageAvailable()) return;
  try { window.localStorage.removeItem(key); }
  catch {}
}
function loadPersistentState() {
  const viewMode = readStoredValue(STORAGE_KEYS.viewMode);
  if (VIEW_MODE_VALUES.has(viewMode)) state.viewMode = viewMode;

  try {
    const selection = JSON.parse(readStoredValue(STORAGE_KEYS.selection) || "[]");
    if (Array.isArray(selection)) state.selection = new Set(selection.filter(Boolean));
  } catch {
    state.selection = new Set();
  }
}
function persistViewSettings() {
  writeStoredValue(STORAGE_KEYS.viewMode, state.viewMode);
}
function persistSelection() {
  if (state.selection.size) writeStoredValue(STORAGE_KEYS.selection, JSON.stringify([...state.selection]));
  else removeStoredValue(STORAGE_KEYS.selection);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function toSafeDomId(value, prefix = "id") {
  const safe = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${prefix}-${safe || "item"}`;
}
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function parseList(value) { return String(value || "").split(/[,;|]/).map(item => item.trim()).filter(Boolean); }
function mainCountry(value) { return String(value || "").split(/[,;|/]/).map(item => item.trim()).filter(Boolean)[0] || ""; }
function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}
function parseDateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dayFirst = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dayFirst) return Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseRuntime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return Number.NaN;

  // Plain numeric values are treated as minutes because the source data is expected to store runtimes in minutes.
  const hm = raw.match(/(\d+)\s*(h|hr|hrs|hour|hours)\s*(\d+)?\s*(m|min|mins|minute|minutes)?/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[3] || 0);

  const colon = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const min = raw.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?/i);
  return min ? Number(min[1]) : Number.NaN;
}
function formatRuntime(minutes) {
  if (!Number.isFinite(minutes)) return "Durée inconnue";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`;
}

function cacheEls() {
  [
    "status", "diagnostics", "resultSummary", "movieGrid", "activeFilters", "selectionPanel", "filterPanel", "filterBackdrop",
    "openFilters", "closeFilters", "applyFilters", "clearFilters", "reloadData", "filterCount",
    "searchInput", "sortSelect", "viewModeSelect", "toggleSelectionPanel", "selectionCount",
    "backToTop", "genreMatchMode", "actorMatchMode", "directorMatchMode"
  ].forEach(id => { els[id] = byId(id); });

  for (const cfg of Object.values(categories)) {
    els[cfg.listId] = byId(cfg.listId);
    els[cfg.countId] = byId(cfg.countId);
    if (cfg.searchId) els[cfg.searchId] = byId(cfg.searchId);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      rows.push([...row, field]);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  rows.push([...row, field]);
  return rows.filter(items => items.some(item => String(item || "").trim()));
}

function csvToTable(text) {
  const records = parseCsv(text);
  if (records.length < 2) throw new Error("Le point d’accès CSV ne contient aucune ligne exploitable.");

  const labels = records[0].map((label, index) => String(label || "").replace(/^\uFEFF/, "").trim() || `Colonne ${index + 1}`);
  const rows = records.slice(1).map(record => Object.fromEntries(labels.map((label, index) => [label, record[index] ?? ""])));
  return { labels, rows };
}

function detectColumns(labels) {
  const normalized = labels.map(raw => ({ raw, norm: normalize(raw) }));
  const pick = (aliases, exclusions = []) => {
    const aliasNorms = aliases.map(normalize);
    const excluded = exclusions.map(normalize);
    const candidates = normalized.filter(item => !excluded.some(ex => item.norm === ex || item.norm.includes(ex)));
    return candidates.find(item => aliasNorms.includes(item.norm))?.raw
      || candidates.find(item => aliasNorms.some(alias => item.norm.includes(alias)))?.raw
      || null;
  };

  const title = pick(columnAliases.title, columnAliases.originalTitle);
  const url = pick(columnAliases.url);
  const warnings = [];
  if (!title) warnings.push(`La colonne de titre n’a pas été détectée. Utilisation de la première colonne : "${labels[0]}".`);
  if (!url) warnings.push("Aucune colonne URL/IMDb n’a été détectée. La sélection temporaire reste disponible, mais sa persistance utilise un identifiant de secours moins stable basé sur le titre, l’année et la position.");

  return {
    columns: {
      title: title || labels[0],
      originalTitle: pick(columnAliases.originalTitle),
      genres: pick(columnAliases.genres),
      runtime: pick(columnAliases.runtime),
      year: pick(columnAliases.year),
      releaseDate: pick(columnAliases.releaseDate),
      position: pick(columnAliases.position),
      imdbRating: pick(columnAliases.imdbRating),
      url,
      poster: pick(columnAliases.poster),
      country: pick(columnAliases.country),
      actors: pick(columnAliases.actors),
      directors: pick(columnAliases.directors)
    },
    warnings
  };
}

function rawCell(row, field, columns = state.columns) {
  const column = columns[field];
  return column ? row[column] ?? "" : "";
}
function cell(row, field) { return rawCell(row, field); }
function normalizedMovieUrlId(row, columns = state.columns) {
  const rawUrl = String(rawCell(row, "url", columns) || "").trim();
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function fallbackMovieId(row, index = 0, columns = state.columns) {
  // Fallback IDs are intentionally documented as less stable: spreadsheet title/year/position edits can orphan persisted selections.
  const title = normalize([rawCell(row, "title", columns), rawCell(row, "originalTitle", columns)].filter(Boolean).join(" "));
  const release = parseDateValue(rawCell(row, "releaseDate", columns));
  const year = Number.isFinite(release) ? new Date(release).getUTCFullYear() : parseNumber(rawCell(row, "year", columns));
  const position = parseNumber(rawCell(row, "position", columns));
  return `fallback:${title || "untitled"}:${Number.isFinite(year) ? year : "unknown"}:${Number.isFinite(position) ? position : index}`;
}
function legacyMovieIds(row, index = 0, columns = state.columns) {
  const url = normalizedMovieUrlId(row, columns);
  const title = normalize([rawCell(row, "title", columns), rawCell(row, "originalTitle", columns)].filter(Boolean).join(" "));
  const release = parseDateValue(rawCell(row, "releaseDate", columns));
  const year = Number.isFinite(release) ? new Date(release).getUTCFullYear() : parseNumber(rawCell(row, "year", columns));
  const position = parseNumber(rawCell(row, "position", columns));
  return [
    url,
    `movie:${title || "untitled"}:${Number.isFinite(year) ? year : "unknown"}:${Number.isFinite(position) ? position : index}`
  ].filter(Boolean);
}
function makeMovieId(row, index = 0, columns = state.columns) {
  const url = normalizedMovieUrlId(row, columns);
  return url ? `url:${url}` : fallbackMovieId(row, index, columns);
}
function reconcilePersistedSelection(rows = state.rows, columns = state.columns) {
  if (!state.selection.size) return;

  const aliases = new Map();
  rows.forEach((row, index) => {
    const nextId = makeMovieId(row, index, columns);
    legacyMovieIds(row, index, columns).forEach(oldId => aliases.set(oldId, nextId));
  });

  let changed = false;
  const reconciled = new Set();
  for (const id of state.selection) {
    const nextId = aliases.get(id) || id;
    if (nextId !== id) changed = true;
    reconciled.add(nextId);
  }
  if (changed) {
    state.selection = reconciled;
    persistSelection();
  }
}
function movieId(row) {
  return row.__movieExplorerId || makeMovieId(row, Math.max(0, state.rows.indexOf(row)));
}
function isMovieSelected(row) { return state.selection.has(movieId(row)); }
function listFor(row, category) { return parseList(cell(row, categories[category].column)); }
function displayTitle(row) { return cell(row, "title") || cell(row, "originalTitle") || "Sans titre"; }
function equivalentTitle(value) { return normalize(value); }
function displayOriginalTitle(row) {
  const original = cell(row, "originalTitle").trim();
  const title = cell(row, "title").trim();
  return original && equivalentTitle(original) !== equivalentTitle(title) ? original : "";
}
function safeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;

  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function movieUrl(row) {
  const raw = cell(row, "url").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function posterUrl(row) {
  return safeImageUrl(cell(row, "poster"));
}

function encodeFilterValue(value) {
  // Card filter values live in data attributes, so encode them before insertion and decode them on click.
  return encodeURIComponent(String(value || ""));
}
function decodeFilterValue(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}
function filterToggleLabel(category, value) {
  const action = state.selected[category].has(value) ? "Retirer" : "Ajouter";
  return `${action} le filtre ${categories[category].label.toLowerCase()} ${value}`;
}

function clearOptionCountsCache() {
  state.optionCountsCache.clear();
}

function resetData() {
  Object.assign(state, { rows: [], labels: [], columns: {}, warnings: [] });
  clearOptionCountsCache();
}
function resetFilters() {
  Object.assign(state, {
    search: "",
    filterSearch: { actor: "", director: "" },
    matchMode: { ...DEFAULT_MATCH_MODE },
    activePanel: "genre"
  });
  for (const selected of Object.values(state.selected)) selected.clear();
  clearOptionCountsCache();
}
function syncControls() {
  els.searchInput.value = state.search;
  els.sortSelect.value = state.sort;
  els.viewModeSelect.value = state.viewMode;
  for (const category of categoryKeys) {
    byId(`${category}MatchMode`).value = state.matchMode[category];
    const searchId = categories[category].searchId;
    if (searchId) els[searchId].value = state.filterSearch[category] || "";
  }
}
function resetAfterLoadFailure() {
  resetData();
  resetFilters();
  syncControls();
  renderActiveFilters();
  renderFilterLists();
  renderResultSummary([]);
  renderSelectionPanel();
  syncSelectionCount();
  els.diagnostics.hidden = true;
}

async function loadSheet() {
  showLoading();
  const sourceUrl = dataSourceUrl();

  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Impossible de charger le point d’accès CSV. HTTP ${response.status}.`);

    const text = await response.text();
    if (/<!doctype html|<html[\s>]/i.test(text)) throw new Error("Google a renvoyé du HTML au lieu du CSV. Vérifiez que l’onglet est toujours publié.");

    const { labels, rows } = csvToTable(text);
    const detected = detectColumns(labels);
    const usableRows = rows
      .filter(row => Object.values(row).some(value => String(value || "").trim()))
      .map((row, index) => ({ ...row, __movieExplorerId: makeMovieId(row, index, detected.columns) }));
    Object.assign(state, {
      labels,
      rows: usableRows,
      columns: detected.columns,
      warnings: detected.warnings
    });
    reconcilePersistedSelection(usableRows, detected.columns);

    renderDiagnostics();
    render();
  } catch (error) {
    resetAfterLoadFailure();
    showError(`${error.message}\n\nSource: ${sourceUrl || dataSourceUrl()}`);
  }
}

function showLoading() {
  els.status.hidden = false;
  els.status.textContent = "Chargement de la bibliothèque…";
  els.resultSummary.hidden = true;
  els.diagnostics.hidden = true;
  els.movieGrid.innerHTML = "";
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Chargement…"; });
}
function showError(message) {
  els.status.hidden = false;
  els.status.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  els.resultSummary.hidden = true;
  els.movieGrid.innerHTML = "";
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Aucune donnée chargée"; });
}
function renderDiagnostics() {
  const missing = ["genres", "runtime", "imdbRating", "country", "actors", "directors", "originalTitle", "position", "releaseDate"].filter(field => !state.columns[field]);
  const lines = [
    ...(missing.length ? [`Champs attendus manquants : ${missing.join(", ")}`] : []),
    ...state.warnings
  ];

  els.diagnostics.hidden = !lines.length;
  els.diagnostics.textContent = lines.length
    ? ["Avertissement de détection des colonnes.", ...lines, `Colonnes détectées : ${state.labels.join(", ")}`, "Mettez à jour columnAliases en haut de script.js si nécessaire."].join("\n")
    : "";
}

function matchesList(values, selected, mode) {
  const wanted = [...selected];
  if (!wanted.length) return true;
  return mode === "all" ? wanted.every(value => values.includes(value)) : wanted.some(value => values.includes(value));
}
function rowSearchText(row) {
  // Row contents are immutable after load, so the normalized search blob is memoized per row.
  if (row.__searchText === undefined) row.__searchText = normalize(Object.values(row).join(" "));
  return row.__searchText;
}
function matchesSearch(row) { return !state.search || rowSearchText(row).includes(normalize(state.search)); }
function matchesFilters(row, skipCategory = null) {
  return matchesSearch(row) && categoryKeys.every(category => (
    category === skipCategory || matchesList(listFor(row, category), state.selected[category], state.matchMode[category])
  ));
}
function filteredRows() { return state.rows.filter(row => matchesFilters(row)); }

function optionCountsCacheKey(category) {
  return JSON.stringify({
    category,
    search: state.search,
    matchMode: state.matchMode,
    selected: categoryKeys.map(key => [key, [...state.selected[key]].sort()])
  });
}

function baseOptionCounts(category) {
  const cfg = categories[category];
  if (!state.columns[cfg.column]) return [];

  const cacheKey = optionCountsCacheKey(category);
  if (state.optionCountsCache.has(cacheKey)) return state.optionCountsCache.get(cacheKey);

  const skip = state.matchMode[category] === "any" ? category : null;
  const counts = new Map();
  for (const row of state.rows.filter(item => matchesFilters(item, skip))) {
    for (const value of listFor(row, category)) counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const value of state.selected[category]) if (!counts.has(value)) counts.set(value, 0);

  const sorted = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  state.optionCountsCache.set(cacheKey, sorted);
  return sorted;
}

function optionCounts(category) {
  const term = normalize(state.filterSearch[category] || "");
  return baseOptionCounts(category).filter(([value]) => !term || normalize(value).includes(term));
}

function renderFilterLists() {
  categoryKeys.forEach(renderFilterList);
  updateCounts();
  syncDynamicFocusableFallback();
}
function renderFilterList(category) {
  const cfg = categories[category];
  const container = els[cfg.listId];
  const columnDetected = Boolean(state.columns[cfg.column]);
  const counts = optionCounts(category);

  if (!counts.length) {
    container.textContent = columnDetected ? cfg.empty : `Colonne ${cfg.label.toLowerCase()} non détectée`;
    return;
  }

  const limit = category === "genre" ? Infinity : (state.filterSearch[category] ? 180 : 80);
  const visible = counts.slice(0, limit);
  const hidden = counts.length - visible.length;

  container.innerHTML = visible.map(([value, count]) => `
    <label class="filter-option">
      <input type="checkbox" value="${escapeHtml(value)}" ${state.selected[category].has(value) ? "checked" : ""}>
      <span class="filter-option__content">
        <span class="filter-option__label">${escapeHtml(value)}</span>
        <span class="filter-option__count">${count}</span>
      </span>
    </label>`).join("") + (hidden ? `<p class="hint">+${hidden} autres. Recherchez pour réduire la liste.</p>` : "");
}

function setFilterSelection(category, value, selected) {
  state.selected[category][selected ? "add" : "delete"](value);
  render();
}
function toggleFilterSelection(category, value) {
  if (!state.selected[category]) return;
  setFilterSelection(category, value, !state.selected[category].has(value));
}
function isFilterSearchFocused() {
  return searchableCategories.some(category => els[categories[category].searchId] === document.activeElement);
}
function immediateFilterTap(category, option, event) {
  if (event.pointerType && event.pointerType !== "touch") return;
  // iOS Safari can use the first tap after typing to dismiss the keyboard; select immediately only in that state.
  if (!isFilterSearchFocused()) return;

  const input = option?.querySelector("input");
  if (!input) return;
  event.preventDefault();
  setFilterSelection(category, input.value, !input.checked);
}

function sortRows(rows) {
  const [field, direction] = state.sort.split("-");
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compare(sortValue(a, field), sortValue(b, field), sign));
}
function sortableTitle(value) {
  // Same normalization is used for title and original-title sorting: leading articles and edge punctuation do not affect rank.
  return normalizeSortText(stripLeadingArticle(stripSortEdgePunctuation(String(value || ""))));
}
function stripSortEdgePunctuation(value) {
  return value.trim().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
}
function stripLeadingArticle(value) {
  return value
    .replace(/^(?:l[’']|le|la|les|un|une|des|the|a|an)\s+/i, "")
    .replace(/^(?:l[’'])/i, "")
    .trim();
}
function normalizeSortText(value) {
  return value
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function sortValue(row, field) {
  if (field === "runtime") return parseRuntime(cell(row, "runtime"));
  if (field === "position") return parseNumber(cell(row, "position"));
  if (field === "year") {
    const releaseDate = parseDateValue(cell(row, "releaseDate"));
    if (Number.isFinite(releaseDate)) return releaseDate;

    const year = parseNumber(cell(row, "year"));
    return Number.isFinite(year) ? Date.UTC(year, 0, 1) : Number.NaN;
  }
  if (field === "imdbRating") return parseNumber(cell(row, field));
  if (field === "originalTitle") return sortableTitle(cell(row, "originalTitle") || displayTitle(row));
  if (field === "country") return mainCountry(cell(row, "country"));
  return sortableTitle(displayTitle(row));
}
function compare(a, b, sign) {
  const numberSort = typeof a === "number" || typeof b === "number";
  if (numberSort) {
    const validA = Number.isFinite(a);
    const validB = Number.isFinite(b);
    if (!validA && !validB) return 0;
    if (!validA) return 1;
    if (!validB) return -1;
    return (a - b) * sign;
  }

  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * sign;
}

function sortLabel() {
  const option = els.sortSelect?.selectedOptions?.[0];
  return option ? option.textContent.trim() : state.sort;
}
function pluralize(count, singular, plural = `${singular}s`) { return `${count} ${count > 1 ? plural : singular}`; }
function renderResultSummary(rows) {
  if (!els.resultSummary) return;
  if (!state.rows.length) {
    els.resultSummary.hidden = true;
    els.resultSummary.textContent = "";
    return;
  }

  const filters = activeCount();
  const selection = state.selection.size;
  els.resultSummary.hidden = false;
  els.resultSummary.innerHTML = [
    `<strong>${rows.length}</strong> / ${state.rows.length} films affichés`,
    `Tri : ${escapeHtml(sortLabel())}`,
    pluralize(filters, "filtre actif", "filtres actifs"),
    pluralize(selection, "film sélectionné", "films sélectionnés")
  ].map(item => `<span>${item}</span>`).join("");
}
function effectiveViewMode() {
  return DESKTOP_QUERY.matches ? state.viewMode : "cards";
}
function syncDisplaySettings() {
  const mode = effectiveViewMode();
  els.movieGrid.dataset.viewMode = mode;
  document.documentElement.dataset.viewMode = mode;
}
function render() {
  clearOptionCountsCache();
  const rows = sortRows(filteredRows());
  const mode = effectiveViewMode();

  els.status.hidden = true;
  syncDisplaySettings();
  renderResultSummary(rows);
  renderActiveFilters();
  renderFilterLists();
  syncSelectionCount();
  renderSelectionPanel();
  els.movieGrid.innerHTML = rows.length
    ? rows.map(mode === "list" ? renderMovieListItem : renderMovieCard).join("")
    : `<div class="empty">Aucun film ne correspond aux filtres actuels.</div>`;
  requestAnimationFrame(syncBackToTop);
}
function movieViewModel(row) {
  const title = displayTitle(row);
  return {
    row,
    id: movieId(row),
    title,
    titleHtml: escapeHtml(title),
    originalTitle: displayOriginalTitle(row),
    url: movieUrl(row),
    posterUrl: posterUrl(row),
    rating: cell(row, "imdbRating"),
    runtime: parseRuntime(cell(row, "runtime")),
    year: cell(row, "year"),
    country: mainCountry(cell(row, "country")),
    genres: listFor(row, "genre"),
    actors: listFor(row, "actor"),
    directors: listFor(row, "director")
  };
}
function renderMoviePoster(model, modifierClass = "") {
  if (!model.posterUrl) return "";
  const className = modifierClass ? `movie-poster ${modifierClass}` : "movie-poster";
  return `
    <figure class="${className}">
      <img src="${escapeHtml(model.posterUrl)}" alt="Affiche de ${model.titleHtml}" loading="lazy" decoding="async">
    </figure>`;
}
function renderMovieTitle(model) {
  const title = model.url
    ? `<a class="movie-title-link" href="${escapeHtml(model.url)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir ${model.titleHtml} sur IMDb">${model.titleHtml}</a>`
    : model.titleHtml;
  return `
    <h2>${title}</h2>
    ${model.originalTitle ? `<p class="original-title">${escapeHtml(model.originalTitle)}</p>` : ""}`;
}
function renderMetaBadges(model) {
  return `
    ${model.rating ? `<span class="meta-badge meta-badge--rating ${ratingClass(model.rating)}">IMDb ${escapeHtml(model.rating)}</span>` : ""}
    <span class="meta-badge">${escapeHtml(formatRuntime(model.runtime))}</span>
    ${model.year ? `<span class="meta-badge">${escapeHtml(model.year)}</span>` : ""}
    ${model.country ? `<span class="meta-badge">${escapeHtml(model.country)}</span>` : ""}`;
}
function renderGenreChips(model) {
  return model.genres.map(genre => renderCardFilterButton("genre", genre, "genre-chip", "genre-chip--selected")).join("");
}
function renderDirectorCredit(model, className = "") {
  return model.directors.length
    ? `<p${className ? ` class="${className}"` : ""}><strong>Réalisation :</strong> ${highlightList(model.directors, state.selected.director)}</p>`
    : "";
}
function renderActorCredit(model) {
  return model.actors.length
    ? `<p class="actors-line"><strong>Acteurs :</strong> ${highlightList(model.actors, state.selected.actor)}</p>`
    : "";
}
function renderSelectionButton(rowOrModel) {
  const id = rowOrModel.id || movieId(rowOrModel);
  const selected = state.selection.has(id);
  const label = selected ? "Retirer de la sélection" : "Ajouter à la sélection";
  const symbol = selected ? "✓" : "+";
  return `<button class="selection-toggle${selected ? " is-selected" : ""}" type="button" data-selection-id="${escapeHtml(id)}" aria-pressed="${selected}" aria-label="${label}" title="${label}"><span aria-hidden="true">${symbol}</span></button>`;
}
function renderMovieCard(row) {
  const model = movieViewModel(row);
  return `
    <article class="movie-card${model.posterUrl ? " movie-card--with-poster" : ""}" data-movie-id="${escapeHtml(model.id)}">
      ${renderMoviePoster(model)}
      <div class="movie-card__body">
        <header class="movie-card__header">
          <div class="movie-card__title-block">${renderMovieTitle(model)}</div>
          ${renderSelectionButton(model)}
        </header>
        <div class="badge-row">${renderMetaBadges(model)}</div>
        <div class="credits">
          ${renderDirectorCredit(model)}
          ${renderActorCredit(model)}
        </div>
        <div class="chips">${renderGenreChips(model)}</div>
      </div>
    </article>`;
}
function renderMovieListItem(row) {
  const model = movieViewModel(row);
  return `
    <article class="movie-card movie-card--list${model.posterUrl ? " movie-card--list-with-poster" : ""}" data-movie-id="${escapeHtml(model.id)}">
      ${renderMoviePoster(model, "movie-poster--list")}
      <div class="movie-list-content">
        <div class="movie-list-top">
          <div class="movie-list-main">
            ${renderMovieTitle(model)}
            ${renderDirectorCredit(model, "movie-list-credit")}
          </div>
          <div class="movie-list-action">${renderSelectionButton(model)}</div>
        </div>
        <div class="movie-list-bottom">
          <div class="movie-list-meta badge-row">${renderMetaBadges(model)}</div>
          <div class="movie-list-genres chips">${renderGenreChips(model)}</div>
        </div>
      </div>
    </article>`;
}
function ratingClass(value) {
  const score = parseNumber(value);
  if (!Number.isFinite(score)) return "meta-badge--rating-unknown";
  return score >= 8 ? "meta-badge--rating-good" : score >= 7 ? "meta-badge--rating-mid" : "meta-badge--rating-low";
}
function highlightList(values, selected) {
  const category = selected === state.selected.director ? "director" : "actor";
  return values
    .map(value => renderCardFilterButton(category, value, "credit-token", "selected-credit"))
    .join(`<span class="credit-separator">, </span>`);
}
function handlePosterError(event) {
  const image = event.target.closest?.(".movie-poster img");
  if (!image) return;
  image.closest(".movie-poster")?.remove();
}
function renderCardFilterButton(category, value, baseClass, selectedClass) {
  const selected = state.selected[category].has(value);
  const classes = [baseClass, "card-filter-button", selected ? selectedClass : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-card-filter-category="${category}" data-card-filter-value="${encodeFilterValue(value)}" aria-pressed="${selected}" aria-label="${escapeHtml(filterToggleLabel(category, value))}">${escapeHtml(value)}</button>`;
}

function selectedRows() {
  const selectedIds = state.selection;
  return state.rows.filter(row => selectedIds.has(movieId(row)));
}
function syncSelectionCount() {
  els.selectionCount.textContent = String(state.selection.size);
  els.selectionCount.hidden = state.selection.size === 0;
  els.toggleSelectionPanel.setAttribute("aria-expanded", String(state.selectionPanelOpen));
}
function toggleMovieSelectionById(id) {
  if (!id) return;
  if (state.selection.has(id)) {
    state.selection.delete(id);
    if (state.selectionDetailId === id) state.selectionDetailId = "";
  } else {
    state.selection.add(id);
  }
  persistSelection();
  render();
}
function clearSelection() {
  state.selection.clear();
  state.selectionDetailId = "";
  persistSelection();
  render();
}
function toggleSelectionDetail(id) {
  if (!id) return;
  state.selectionDetailId = state.selectionDetailId === id ? "" : id;
  renderSelectionPanel();
  // renderSelectionPanel rebuilds the panel's markup, so return focus to the summary the user just activated.
  const selector = typeof CSS !== "undefined" && CSS.escape ? `button[data-selection-detail-id="${CSS.escape(id)}"]` : null;
  if (selector) els.selectionPanel?.querySelector(selector)?.focus();
}
function toggleSelectionPanel() {
  state.selectionPanelOpen = !state.selectionPanelOpen;
  renderSelectionPanel();
  syncSelectionCount();
}
function renderSelectionPanel() {
  if (!els.selectionPanel) return;
  els.selectionPanel.hidden = !state.selectionPanelOpen;
  if (!state.selectionPanelOpen) return;

  const rows = selectedRows();
  // Detail expansion is tied to selected rows, not the filtered result grid, so users can keep reviewing a shortlist while exploring other filters.
  const detailIsValid = rows.some(row => movieId(row) === state.selectionDetailId);
  if (!detailIsValid) state.selectionDetailId = "";

  els.selectionPanel.innerHTML = `
    <div class="selection-panel__header">
      <div>
        <p class="eyebrow">Exploration</p>
        <h2 id="selectionPanelHeading">Sélection temporaire</h2>
        <p>${pluralize(state.selection.size, "film sélectionné", "films sélectionnés")}</p>
      </div>
      <button class="secondary-button selection-clear-button" type="button" data-selection-action="clear" ${state.selection.size ? "" : "disabled"}>Vider</button>
    </div>
    ${rows.length ? `
      <div class="selection-list">
        ${rows.map(row => {
          const id = movieId(row);
          const expanded = state.selectionDetailId === id;
          const detailId = toSafeDomId(id, "selection-detail");
          const meta = [cell(row, "year"), mainCountry(cell(row, "country")), formatRuntime(parseRuntime(cell(row, "runtime")))].filter(Boolean).map(escapeHtml).join(" · ");
          return `
            <article class="selection-item${expanded ? " is-expanded" : ""}">
              <button class="selection-item__summary" type="button" data-selection-detail-id="${escapeHtml(id)}" aria-expanded="${expanded}" aria-controls="${detailId}">
                <span class="selection-item__text">
                  <span class="selection-item__title">${escapeHtml(displayTitle(row))}</span>
                  <span class="selection-item__meta">${meta}</span>
                </span>
                <span class="selection-item__hint">${expanded ? "Masquer" : "Détails"}</span>
              </button>
              <button class="filter-remove" type="button" data-selection-remove-id="${escapeHtml(id)}" aria-label="Retirer ${escapeHtml(displayTitle(row))} de la sélection">×</button>
            </article>
            ${expanded ? `<div id="${detailId}" class="selection-detail">${renderMovieCard(row)}</div>` : ""}`;
        }).join("")}
      </div>` : `<p class="selection-empty">Aucun film sélectionné.</p>`}
  `;
}


function activeFilters() {
  return [
    ...(state.search ? [{ group: "Recherche", category: "search", value: state.search }] : []),
    ...categoryKeys.flatMap(category => [...state.selected[category]].map(value => ({ group: categories[category].label, category, value })))
  ];
}
function renderActiveFilters() {
  els.activeFilters.innerHTML = activeFilters().map(item => `
    <span class="active-filter-chip">
      <span>${escapeHtml(item.group)}: ${escapeHtml(item.value)}</span>
      <button class="filter-remove" type="button" data-filter-category="${escapeHtml(item.category)}" data-filter-value="${encodeFilterValue(item.value)}" aria-label="Retirer le filtre ${escapeHtml(item.group)}">×</button>
    </span>`).join("");
}
function activeCount() { return activeFilters().length; }
function updateCounts() {
  const total = activeCount();
  els.filterCount.textContent = String(total);
  els.filterCount.hidden = total === 0;
  categoryKeys.forEach(category => {
    const count = state.selected[category].size;
    const badge = els[categories[category].countId];
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
}

function setActivePanel(category) {
  state.activePanel = category;
  document.querySelectorAll("[data-filter-category]").forEach(button => {
    const active = button.dataset.filterCategory === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-filter-panel]").forEach(panel => { panel.hidden = panel.dataset.filterPanel !== category; });
}
function openFilters() {
  state.lastFocus = document.activeElement;
  state.filtersOpen = true;
  els.filterPanel.classList.add("is-open");
  els.filterBackdrop.hidden = false;
  document.body.classList.add("filters-open");
  syncFilterA11y();
  syncBackToTop();
  requestAnimationFrame(() => els.closeFilters.focus());
}
function closeFilters() {
  setFilterSearchFocus(false);
  state.filtersOpen = false;
  els.filterPanel.classList.remove("is-open");
  els.filterBackdrop.hidden = true;
  document.body.classList.remove("filters-open");
  syncFilterA11y();
  syncBackToTop();
  if (state.lastFocus?.focus) state.lastFocus.focus();
  state.lastFocus = null;
}
function isFilterPanelVisible() {
  return DESKTOP_QUERY.matches || state.filtersOpen;
}
function syncFilterA11y() {
  const desktop = DESKTOP_QUERY.matches;
  const visible = isFilterPanelVisible();
  const modal = !desktop && state.filtersOpen;
  els.filterPanel.setAttribute("aria-hidden", String(!visible));
  els.filterPanel.toggleAttribute("inert", !visible);
  syncFocusableFallback(!visible);
  if (modal) {
    els.filterPanel.setAttribute("role", "dialog");
    els.filterPanel.setAttribute("aria-modal", "true");
  } else {
    els.filterPanel.removeAttribute("role");
    els.filterPanel.removeAttribute("aria-modal");
  }
}
function handleFilterViewportChange() {
  if (DESKTOP_QUERY.matches && state.filtersOpen) {
    state.filtersOpen = false;
    els.filterPanel.classList.remove("is-open");
    els.filterBackdrop.hidden = true;
    document.body.classList.remove("filters-open");
  }
  syncFilterA11y();
  if (state.rows.length) render();
  else syncBackToTop();
}

function syncDynamicFocusableFallback() {
  if (!SUPPORTS_INERT && !isFilterPanelVisible()) syncFocusableFallback(true);
}
function syncFocusableFallback(disabled) {
  if (SUPPORTS_INERT) return;
  els.filterPanel.querySelectorAll(PANEL_FOCUSABLE).forEach(control => {
    if (disabled) {
      if (!("previousTabIndex" in control.dataset)) control.dataset.previousTabIndex = control.getAttribute("tabindex") ?? "";
      control.setAttribute("tabindex", "-1");
      return;
    }

    if (!("previousTabIndex" in control.dataset)) return;
    const previous = control.dataset.previousTabIndex;
    if (previous) control.setAttribute("tabindex", previous);
    else control.removeAttribute("tabindex");
    delete control.dataset.previousTabIndex;
  });
}
function focusableFilterControls() {
  return [...els.filterPanel.querySelectorAll(FOCUSABLE)].filter(control => !control.closest("[hidden]") && control.getClientRects().length);
}
function trapFilterFocus(event) {
  if (event.key !== "Tab" || !state.filtersOpen || DESKTOP_QUERY.matches) return;
  const focusable = focusableFilterControls();
  const first = focusable[0] || els.filterPanel;
  const last = focusable[focusable.length - 1] || els.filterPanel;

  if (!els.filterPanel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function setFilterSearchFocus(isFocused) {
  els.filterPanel.classList.toggle("filter-panel--searching", isFocused);
  if (!isFocused) return;
  window.setTimeout(() => {
    if (els.filterPanel.contains(document.activeElement)) document.activeElement.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 80);
}

function syncBackToTop() {
  const pageIsLong = document.documentElement.scrollHeight > window.innerHeight * 1.5;
  const visible = pageIsLong && window.scrollY > 700 && !state.filtersOpen;
  if (visible === state.backToTopVisible) return;
  state.backToTopVisible = visible;
  els.backToTop.hidden = !visible;
  els.backToTop.classList.toggle("is-visible", visible);
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearFilters() {
  resetFilters();
  syncControls();
  render();
}
function removeFilter(category, value) {
  if (category === "search") {
    state.search = "";
    els.searchInput.value = "";
  } else if (state.selected[category]) {
    state.selected[category].delete(value);
  } else {
    return;
  }
  render();
}

function bindEvents() {
  els.searchInput.addEventListener("input", event => { state.search = event.target.value; render(); });
  els.sortSelect.addEventListener("change", event => { state.sort = event.target.value; render(); });
  els.viewModeSelect.addEventListener("change", event => {
    state.viewMode = VIEW_MODE_VALUES.has(event.target.value) ? event.target.value : "cards";
    persistViewSettings();
    render();
  });
  els.toggleSelectionPanel.addEventListener("click", toggleSelectionPanel);
  categoryKeys.forEach(category => byId(`${category}MatchMode`).addEventListener("change", event => { state.matchMode[category] = event.target.value; render(); }));

  searchableCategories.forEach(category => {
    const input = els[categories[category].searchId];
    input.addEventListener("input", event => { state.filterSearch[category] = event.target.value; renderFilterLists(); });
    input.addEventListener("focus", () => setFilterSearchFocus(true));
    input.addEventListener("blur", () => window.setTimeout(() => setFilterSearchFocus(false), 120));
  });

  categoryKeys.forEach(category => {
    const list = els[categories[category].listId];
    list.addEventListener("change", event => {
      if (event.target.matches("input[type='checkbox']")) setFilterSelection(category, event.target.value, event.target.checked);
    });
    list.addEventListener("touchstart", event => {
      const option = event.target.closest(".filter-option");
      if (option) immediateFilterTap(category, option, event);
    }, { passive: false });
  });

  els.movieGrid.addEventListener("error", handlePosterError, true);
  els.selectionPanel.addEventListener("error", handlePosterError, true);

  els.movieGrid.addEventListener("click", event => {
    const selectionButton = event.target.closest("button[data-selection-id]");
    if (selectionButton) {
      toggleMovieSelectionById(selectionButton.dataset.selectionId);
      return;
    }

    const button = event.target.closest("button[data-card-filter-category]");
    if (!button) return;
    toggleFilterSelection(button.dataset.cardFilterCategory, decodeFilterValue(button.dataset.cardFilterValue));
  });

  els.clearFilters.addEventListener("click", clearFilters);
  els.reloadData.addEventListener("click", loadSheet);
  els.openFilters.addEventListener("click", openFilters);
  els.closeFilters.addEventListener("click", closeFilters);
  els.applyFilters.addEventListener("click", closeFilters);
  els.filterBackdrop.addEventListener("click", closeFilters);
  els.backToTop.addEventListener("click", scrollToTop);
  window.addEventListener("scroll", syncBackToTop, { passive: true });

  els.activeFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-filter-category]");
    if (!button) return;
    removeFilter(button.dataset.filterCategory, decodeFilterValue(button.dataset.filterValue));
  });
  els.selectionPanel.addEventListener("click", event => {
    const selectionButton = event.target.closest("button[data-selection-id]");
    if (selectionButton) {
      toggleMovieSelectionById(selectionButton.dataset.selectionId);
      return;
    }

    const filterButton = event.target.closest("button[data-card-filter-category]");
    if (filterButton) {
      toggleFilterSelection(filterButton.dataset.cardFilterCategory, decodeFilterValue(filterButton.dataset.cardFilterValue));
      return;
    }

    const removeButton = event.target.closest("button[data-selection-remove-id]");
    if (removeButton) {
      toggleMovieSelectionById(removeButton.dataset.selectionRemoveId);
      return;
    }

    const detailButton = event.target.closest("button[data-selection-detail-id]");
    if (detailButton) {
      toggleSelectionDetail(detailButton.dataset.selectionDetailId);
      return;
    }

    if (event.target.closest("button[data-selection-action='clear']")) clearSelection();
  });
  document.querySelectorAll("[data-filter-category]").forEach(button => button.addEventListener("click", () => setActivePanel(button.dataset.filterCategory)));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.filtersOpen) closeFilters();
    trapFilterFocus(event);
  });

  if (DESKTOP_QUERY.addEventListener) DESKTOP_QUERY.addEventListener("change", handleFilterViewportChange);
  else DESKTOP_QUERY.addListener(handleFilterViewportChange);
}

function initApp() {
  cacheEls();
  loadPersistentState();
  syncControls();
  bindEvents();
  setActivePanel(state.activePanel);
  syncFilterA11y();
  syncDisplaySettings();
  syncSelectionCount();
  syncBackToTop();
  loadSheet();
}

if (typeof window !== "undefined") {
  window.__MovieExplorerTestHooks = {
    activeCount,
    activeFilters,
    baseOptionCounts,
    categories,
    cell,
    clearFilters,
    clearSelection,
    columnAliases,
    compare,
    csvToTable,
    dataSourceUrl,
    detectColumns,
    displayOriginalTitle,
    displayTitle,
    effectiveViewMode,
    equivalentTitle,
    isMovieSelected,
    loadPersistentState,
    makeMovieId,
    fallbackMovieId,
    legacyMovieIds,
    movieId,
    filteredRows,
    formatRuntime,
    listFor,
    loadSheet,
    mainCountry,
    matchesFilters,
    matchesList,
    movieUrl,
    posterUrl,
    safeImageUrl,
    normalize,
    normalizeSortText,
    optionCounts,
    parseCsv,
    parseDateValue,
    parseList,
    parseNumber,
    parseRuntime,
    ratingClass,
    renderCardFilterButton,
    renderResultSummary,
    reconcilePersistedSelection,
    resetStorageAvailabilityForTests,
    resetAfterLoadFailure,
    selectedRows,
    syncDisplaySettings,
    syncSelectionCount,
    toggleMovieSelectionById,
    toggleSelectionDetail,
    toSafeDomId,
    sortRows,
    sortValue,
    sortableTitle,
    state,
    stripLeadingArticle,
    stripSortEdgePunctuation
  };

  if (!window.MOVIE_EXPLORER_SKIP_AUTO_INIT) initApp();
}
