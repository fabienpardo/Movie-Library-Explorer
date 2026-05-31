const PUBLISHED_SHEET_ID = "2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK";
const GID = "70337195";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;
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
  imdbRating: ["imdb rating", "imdb", "imdb score", "imdb rate", "imdb user rating"],
  url: ["url", "link", "movie url", "imdb url", "imdb link", "imdb title url", "imdb page", "imdb title page"],
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

const els = {};
const state = {
  rows: [],
  labels: [],
  columns: {},
  warnings: [],
  search: "",
  sort: "title-asc",
  filterSearch: { actor: "", director: "" },
  matchMode: { ...DEFAULT_MATCH_MODE },
  selected: { genre: new Set(), actor: new Set(), director: new Set() },
  activePanel: "genre",
  filtersOpen: false,
  lastFocus: null,
  backToTopVisible: null,
  optionCountsCache: new Map()
};

function byId(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
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
    "status", "diagnostics", "movieGrid", "activeFilters", "filterPanel", "filterBackdrop",
    "openFilters", "closeFilters", "applyFilters", "clearFilters", "reloadData", "filterCount",
    "searchInput", "sortSelect", "backToTop", "genreMatchMode", "actorMatchMode", "directorMatchMode"
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

  const title = pick(columnAliases.title, ["original title"]);
  return {
    columns: {
      title: title || labels[0],
      originalTitle: pick(columnAliases.originalTitle),
      genres: pick(columnAliases.genres),
      runtime: pick(columnAliases.runtime),
      year: pick(columnAliases.year),
      imdbRating: pick(columnAliases.imdbRating),
      url: pick(columnAliases.url),
      country: pick(columnAliases.country),
      actors: pick(columnAliases.actors),
      directors: pick(columnAliases.directors)
    },
    warnings: title ? [] : [`La colonne de titre n’a pas été détectée. Utilisation de la première colonne : "${labels[0]}".`]
  };
}

function cell(row, field) {
  const column = state.columns[field];
  return column ? row[column] ?? "" : "";
}
function listFor(row, category) { return parseList(cell(row, categories[category].column)); }
function displayTitle(row) { return cell(row, "title") || cell(row, "originalTitle") || "Sans titre"; }
function displayOriginalTitle(row) {
  const original = cell(row, "originalTitle");
  const title = cell(row, "title");
  return original && original !== title ? original : "";
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
  els.diagnostics.hidden = true;
}

async function loadSheet() {
  showLoading();

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Impossible de charger le point d’accès CSV. HTTP ${response.status}.`);

    const text = await response.text();
    if (/<!doctype html|<html[\s>]/i.test(text)) throw new Error("Google a renvoyé du HTML au lieu du CSV. Vérifiez que l’onglet est toujours publié.");

    const { labels, rows } = csvToTable(text);
    const detected = detectColumns(labels);
    Object.assign(state, {
      labels,
      rows: rows.filter(row => Object.values(row).some(value => String(value || "").trim())),
      columns: detected.columns,
      warnings: detected.warnings
    });

    renderDiagnostics();
    render();
  } catch (error) {
    resetAfterLoadFailure();
    showError(`${error.message}\n\nSource: ${SHEET_CSV_URL}`);
  }
}

function showLoading() {
  els.status.textContent = "Chargement de la bibliothèque…";
  els.diagnostics.hidden = true;
  els.movieGrid.innerHTML = "";
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Chargement…"; });
}
function showError(message) {
  els.status.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  els.movieGrid.innerHTML = "";
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Aucune donnée chargée"; });
}
function renderDiagnostics() {
  const missing = ["genres", "runtime", "imdbRating", "country", "actors", "directors", "originalTitle"].filter(field => !state.columns[field]);
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
function matchesSearch(row) { return !state.search || normalize(Object.values(row).join(" ")).includes(normalize(state.search)); }
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
  if (field === "year" || field === "imdbRating") return parseNumber(cell(row, field));
  if (field === "originalTitle") return sortableTitle(displayOriginalTitle(row));
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

function render() {
  clearOptionCountsCache();
  const rows = sortRows(filteredRows());
  const totalRuntime = rows.reduce((sum, row) => {
    const runtime = parseRuntime(cell(row, "runtime"));
    return Number.isFinite(runtime) ? sum + runtime : sum;
  }, 0);

  els.status.innerHTML = `<span><strong>${rows.length}</strong> / ${state.rows.length} films</span><span><strong>${escapeHtml(formatRuntime(totalRuntime))}</strong> durée totale</span>`;
  renderActiveFilters();
  renderFilterLists();
  els.movieGrid.innerHTML = rows.length ? rows.map(renderMovieCard).join("") : `<div class="empty">Aucun film ne correspond aux filtres actuels.</div>`;
  requestAnimationFrame(syncBackToTop);
}
function renderMovieCard(row) {
  const rating = cell(row, "imdbRating");
  const runtime = parseRuntime(cell(row, "runtime"));
  const year = cell(row, "year");
  const country = mainCountry(cell(row, "country"));
  const genres = listFor(row, "genre");
  const actors = listFor(row, "actor");
  const directors = listFor(row, "director");
  const title = displayTitle(row);
  const originalTitle = displayOriginalTitle(row);
  const url = movieUrl(row);
  const titleContent = escapeHtml(title);

  return `
    <article class="movie-card">
      <header class="movie-card__header">
        <h2>${url ? `<a class="movie-title-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir ${titleContent} sur IMDb">${titleContent}</a>` : titleContent}</h2>
        ${originalTitle ? `<p class="original-title">${escapeHtml(originalTitle)}</p>` : ""}
      </header>
      <div class="badge-row">
        ${rating ? `<span class="meta-badge meta-badge--rating ${ratingClass(rating)}">IMDb ${escapeHtml(rating)}</span>` : ""}
        <span class="meta-badge">${escapeHtml(formatRuntime(runtime))}</span>
        ${year ? `<span class="meta-badge">${escapeHtml(year)}</span>` : ""}
        ${country ? `<span class="meta-badge">${escapeHtml(country)}</span>` : ""}
      </div>
      <div class="credits">
        ${directors.length ? `<p><strong>Réalisation :</strong> ${highlightList(directors, state.selected.director)}</p>` : ""}
        ${actors.length ? `<p class="actors-line"><strong>Acteurs :</strong> ${highlightList(actors, state.selected.actor)}</p>` : ""}
      </div>
      <div class="chips">${genres.map(genre => renderCardFilterButton("genre", genre, "genre-chip", "genre-chip--selected")).join("")}</div>
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
function renderCardFilterButton(category, value, baseClass, selectedClass) {
  const selected = state.selected[category].has(value);
  const classes = [baseClass, "card-filter-button", selected ? selectedClass : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-card-filter-category="${category}" data-card-filter-value="${encodeFilterValue(value)}" aria-pressed="${selected}" aria-label="${escapeHtml(filterToggleLabel(category, value))}">${escapeHtml(value)}</button>`;
}

function activeFilters() {
  return [
    ...(state.search ? [{ group: "Recherche", category: "search", value: state.search }] : []),
    ...categoryKeys.flatMap(category => [...state.selected[category]].map(value => ({ group: categories[category].label, category, value })))
  ];
}
function renderActiveFilters() {
  els.activeFilters.innerHTML = activeFilters().map((item, index) => `
    <span class="active-filter-chip">
      <span>${escapeHtml(item.group)}: ${escapeHtml(item.value)}</span>
      <button class="filter-remove" type="button" data-filter-index="${index}" aria-label="Retirer le filtre ${escapeHtml(item.group)}">×</button>
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
  syncBackToTop();
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
  } else {
    state.selected[category].delete(value);
  }
  render();
}

function bindEvents() {
  els.searchInput.addEventListener("input", event => { state.search = event.target.value; render(); });
  els.sortSelect.addEventListener("change", event => { state.sort = event.target.value; render(); });
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

  els.movieGrid.addEventListener("click", event => {
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
    const button = event.target.closest("button[data-filter-index]");
    if (!button) return;
    const item = activeFilters()[Number(button.dataset.filterIndex)];
    if (item) removeFilter(item.category, item.value);
  });
  document.querySelectorAll("[data-filter-category]").forEach(button => button.addEventListener("click", () => setActivePanel(button.dataset.filterCategory)));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.filtersOpen) closeFilters();
    trapFilterFocus(event);
  });

  if (DESKTOP_QUERY.addEventListener) DESKTOP_QUERY.addEventListener("change", handleFilterViewportChange);
  else DESKTOP_QUERY.addListener(handleFilterViewportChange);
}

cacheEls();
bindEvents();
setActivePanel(state.activePanel);
syncFilterA11y();
syncBackToTop();
loadSheet();
