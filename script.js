const PUBLISHED_SHEET_ID = "2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK";
const GID = "70337195";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;
const DESKTOP_QUERY = window.matchMedia("(min-width: 760px)");

// Update these aliases if the Google Sheet column names change.
const columnAliases = {
  title: ["title", "movie", "movie title", "name"],
  originalTitle: ["original title", "originaltitle", "original name", "original movie title"],
  genres: ["genre", "genres"],
  runtime: ["runtime", "runtime min", "runtime mins", "runtime minutes", "duration", "duration min", "duration mins", "duration minutes", "running time"],
  year: ["year", "release year", "movie year"],
  imdbRating: ["imdb rating", "imdb", "imdb score", "imdb rate", "imdb user rating"],
  country: ["country", "countries", "production country", "production countries", "main country", "origin country", "country of origin", "nationality"],
  actors: ["actor", "actors", "cast", "main cast", "stars", "starring", "lead actors"],
  directors: ["director", "directors", "directed by"]
};

const els = {};
const state = {
  rows: [],
  labels: [],
  columns: {},
  warnings: [],
  search: "",
  sort: "title-asc",
  filterSearch: { actor: "", director: "" },
  matchMode: { genre: "any", actor: "any", director: "any" },
  selected: { genre: new Set(), actor: new Set(), director: new Set() },
  activePanel: "genre",
  filtersOpen: false,
  lastFocus: null
};

const fieldConfig = {
  genre: {
    column: "genres",
    listId: "genreList",
    countId: "genreSelectedCount",
    parser: parseList,
    empty: "No genres available for the current filters"
  },
  actor: {
    column: "actors",
    listId: "actorList",
    countId: "actorSelectedCount",
    parser: parseList,
    searchKey: "actor",
    empty: "No actors available for the current filters"
  },
  director: {
    column: "directors",
    listId: "directorList",
    countId: "directorSelectedCount",
    parser: parseList,
    searchKey: "director",
    empty: "No directors available for the current filters"
  }
};

function cacheEls() {
  [
    "status", "diagnostics", "movieGrid", "activeFilters", "filterPanel", "filterBackdrop",
    "openFilters", "closeFilters", "applyFilters", "clearFilters", "reloadData", "filterCount",
    "searchInput", "sortSelect", "genreMatchMode", "actorMatchMode", "directorMatchMode",
    "actorFilterSearch", "directorFilterSearch", "genreList", "actorList", "directorList",
    "genreSelectedCount", "actorSelectedCount", "directorSelectedCount"
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseList(value) {
  return String(value || "").split(/[,;|]/).map(item => item.trim()).filter(Boolean);
}

function mainCountry(value) {
  return String(value || "").split(/[,;|/]/).map(item => item.trim()).filter(Boolean)[0] || "";
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function parseRuntime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return Number.NaN;

  const hm = raw.match(/(\d+)\s*(h|hr|hrs|hour|hours)\s*(\d+)?\s*(m|min|mins|minute|minutes)?/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[3] || 0);

  const colon = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const min = raw.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?/i);
  return min ? Number(min[1]) : Number.NaN;
}

function formatRuntime(minutes) {
  if (!Number.isFinite(minutes)) return "Runtime unknown";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
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
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows.filter(items => items.some(item => String(item || "").trim()));
}

function csvToTable(text) {
  const records = parseCsv(text);
  if (records.length < 2) throw new Error("The CSV endpoint returned no usable rows.");

  const labels = records[0].map((label, index) => String(label || "").replace(/^\uFEFF/, "").trim() || `Column ${index + 1}`);
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
  const warnings = title ? [] : [`Title column was not detected. Falling back to first column: "${labels[0]}".`];

  return {
    columns: {
      title: title || labels[0],
      originalTitle: pick(columnAliases.originalTitle),
      genres: pick(columnAliases.genres),
      runtime: pick(columnAliases.runtime),
      year: pick(columnAliases.year),
      imdbRating: pick(columnAliases.imdbRating),
      country: pick(columnAliases.country),
      actors: pick(columnAliases.actors),
      directors: pick(columnAliases.directors)
    },
    warnings
  };
}

function cell(row, field) {
  const column = state.columns[field];
  return column ? row[column] ?? "" : "";
}

async function loadSheet() {
  showLoading();

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load the CSV endpoint. HTTP ${response.status}.`);

    const text = await response.text();
    if (/<!doctype html|<html[\s>]/i.test(text)) throw new Error("Google returned HTML instead of CSV. Check that the sheet tab is still published.");

    const { labels, rows } = csvToTable(text);
    const detected = detectColumns(labels);
    state.labels = labels;
    state.rows = rows.filter(row => Object.values(row).some(value => String(value || "").trim()));
    state.columns = detected.columns;
    state.warnings = detected.warnings;

    renderDiagnostics();
    render();
  } catch (error) {
    showError(`${error.message}\n\nSource: ${SHEET_CSV_URL}`);
  }
}

function showLoading() {
  els.status.textContent = "Loading movie library…";
  els.diagnostics.hidden = true;
  els.movieGrid.innerHTML = "";
  [els.genreList, els.actorList, els.directorList].forEach(el => { el.textContent = "Loading…"; });
}

function showError(message) {
  els.status.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  els.movieGrid.innerHTML = "";
  [els.genreList, els.actorList, els.directorList].forEach(el => { el.textContent = "No data loaded"; });
}

function renderDiagnostics() {
  const expected = ["genres", "runtime", "imdbRating", "country", "actors", "directors", "originalTitle"];
  const missing = expected.filter(field => !state.columns[field]);
  const lines = [];

  if (missing.length) lines.push(`Missing expected fields: ${missing.join(", ")}`);
  lines.push(...state.warnings);

  if (!lines.length) {
    els.diagnostics.hidden = true;
    return;
  }

  lines.unshift("Column detection warning.");
  lines.push(`Detected columns: ${state.labels.join(", ")}`);
  lines.push("Update columnAliases near the top of script.js if needed.");
  els.diagnostics.textContent = lines.join("\n");
  els.diagnostics.hidden = false;
}

function rowValues(row) {
  return {
    genre: parseList(cell(row, "genres")),
    actor: parseList(cell(row, "actors")),
    director: parseList(cell(row, "directors"))
  };
}

function matchesList(values, selected, mode) {
  const items = [...selected];
  if (!items.length) return true;
  return mode === "all" ? items.every(item => values.includes(item)) : items.some(item => values.includes(item));
}

function matchesSearch(row) {
  return !state.search || normalize(Object.values(row).join(" ")).includes(normalize(state.search));
}

function matchesFilters(row, skipCategory = null) {
  const values = rowValues(row);
  return matchesSearch(row)
    && (skipCategory === "genre" || matchesList(values.genre, state.selected.genre, state.matchMode.genre))
    && (skipCategory === "actor" || matchesList(values.actor, state.selected.actor, state.matchMode.actor))
    && (skipCategory === "director" || matchesList(values.director, state.selected.director, state.matchMode.director));
}

function filteredRows() {
  return state.rows.filter(row => matchesFilters(row));
}

function optionRows(category) {
  const skipSameCategory = state.matchMode[category] === "any" ? category : null;
  return state.rows.filter(row => matchesFilters(row, skipSameCategory));
}

function valueCounts(rows, category) {
  const { column, parser } = fieldConfig[category];
  const columnName = state.columns[column];
  if (!columnName) return [];

  const counts = new Map();
  for (const row of rows) {
    for (const value of parser(row[columnName])) counts.set(value, (counts.get(value) || 0) + 1);
  }

  for (const selected of state.selected[category]) {
    if (!counts.has(selected)) counts.set(selected, 0);
  }

  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function searchOptionCounts(counts, category) {
  const key = fieldConfig[category].searchKey;
  if (!key || !state.filterSearch[key]) return counts;
  const term = normalize(state.filterSearch[key]);
  return counts.filter(([value]) => normalize(value).includes(term));
}

function sortedOptions(counts, category) {
  const selected = state.selected[category];
  return [...counts].sort((a, b) => {
    if (selected.has(a[0]) !== selected.has(b[0])) return selected.has(a[0]) ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });
}

function renderFilterLists() {
  for (const category of Object.keys(fieldConfig)) renderFilterList(category);
  updateCounts();
}

function renderFilterList(category) {
  const cfg = fieldConfig[category];
  const container = els[cfg.listId];
  const columnDetected = Boolean(state.columns[cfg.column]);
  let counts = columnDetected ? valueCounts(optionRows(category), category) : [];
  counts = sortedOptions(searchOptionCounts(counts, category), category);

  if (!counts.length) {
    container.textContent = columnDetected ? cfg.empty : `No ${category} column detected`;
    return;
  }

  const limit = category === "genre" ? Infinity : (state.filterSearch[cfg.searchKey] ? 180 : 80);
  const visible = counts.slice(0, limit);
  const hidden = counts.length - visible.length;

  container.innerHTML = visible.map(([value, count]) => {
    const checked = state.selected[category].has(value) ? "checked" : "";
    return `
      <label class="filter-option">
        <input type="checkbox" value="${escapeHtml(value)}" ${checked} />
        <span class="filter-option__content">
          <span class="filter-option__label">${escapeHtml(value)}</span>
          <span class="filter-option__count">${count}</span>
        </span>
      </label>`;
  }).join("") + (hidden > 0 ? `<p class="hint">+${hidden} more. Search to narrow the list.</p>` : "");

  container.querySelectorAll("input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) state.selected[category].add(input.value);
      else state.selected[category].delete(input.value);
      render();
    });
  });
}

function sortRows(rows) {
  const [field, direction] = state.sort.split("-");
  const multiplier = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compare(sortValue(a, field), sortValue(b, field), multiplier));
}

function sortValue(row, field) {
  if (field === "runtime") return parseRuntime(cell(row, "runtime"));
  if (field === "year") return parseNumber(cell(row, "year"));
  if (field === "imdbRating") return parseNumber(cell(row, "imdbRating"));
  if (field === "originalTitle") return displayOriginalTitle(row);
  if (field === "country") return mainCountry(cell(row, "country"));
  return displayTitle(row);
}

function compare(a, b, multiplier) {
  const aNumber = typeof a === "number";
  const bNumber = typeof b === "number";
  if (aNumber || bNumber) {
    const aValid = Number.isFinite(a);
    const bValid = Number.isFinite(b);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1;
    if (!bValid) return -1;
    return (a - b) * multiplier;
  }

  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * multiplier;
}

function displayTitle(row) {
  return cell(row, "title") || cell(row, "originalTitle") || "Untitled";
}

function displayOriginalTitle(row) {
  const original = cell(row, "originalTitle");
  const title = cell(row, "title");
  return original && original !== title ? original : "";
}

function render() {
  const rows = sortRows(filteredRows());
  const totalRuntime = rows.reduce((sum, row) => {
    const runtime = parseRuntime(cell(row, "runtime"));
    return Number.isFinite(runtime) ? sum + runtime : sum;
  }, 0);

  els.status.innerHTML = `
    <span><strong>${rows.length}</strong> / ${state.rows.length} movies</span>
    <span><strong>${escapeHtml(formatRuntime(totalRuntime))}</strong> total runtime</span>`;

  renderActiveFilters();
  renderFilterLists();
  els.movieGrid.innerHTML = rows.length ? rows.map(renderMovieCard).join("") : `<div class="empty">No movies match the current filters.</div>`;
}

function renderMovieCard(row) {
  const title = displayTitle(row);
  const originalTitle = displayOriginalTitle(row);
  const runtime = parseRuntime(cell(row, "runtime"));
  const rating = cell(row, "imdbRating");
  const country = mainCountry(cell(row, "country"));
  const genres = parseList(cell(row, "genres"));
  const actors = parseList(cell(row, "actors"));
  const directors = parseList(cell(row, "directors"));
  const year = cell(row, "year");

  const meta = [
    rating ? `<span class="meta-badge meta-badge--rating ${ratingClass(rating)}">IMDb ${escapeHtml(rating)}</span>` : "",
    `<span class="meta-badge">${escapeHtml(formatRuntime(runtime))}</span>`,
    year ? `<span class="meta-badge">${escapeHtml(year)}</span>` : "",
    country ? `<span class="meta-badge">${escapeHtml(country)}</span>` : ""
  ].join("");

  return `
    <article class="movie-card">
      <header class="movie-card__header">
        <h2>${escapeHtml(title)}</h2>
        ${originalTitle ? `<p class="original-title">${escapeHtml(originalTitle)}</p>` : ""}
      </header>
      <div class="badge-row">${meta}</div>
      <div class="credits">
        ${directors.length ? `<p><strong>Director:</strong> ${highlightList(directors, state.selected.director)}</p>` : ""}
        ${actors.length ? `<p class="actors-line"><strong>Actors:</strong> ${highlightList(actors, state.selected.actor)}</p>` : ""}
      </div>
      <div class="chips">${genres.map(genre => `<span class="genre-chip ${state.selected.genre.has(genre) ? "genre-chip--selected" : ""}">${escapeHtml(genre)}</span>`).join("")}</div>
    </article>`;
}

function ratingClass(value) {
  const score = parseNumber(value);
  if (!Number.isFinite(score)) return "meta-badge--rating-unknown";
  if (score >= 8) return "meta-badge--rating-good";
  if (score >= 7) return "meta-badge--rating-mid";
  return "meta-badge--rating-low";
}

function highlightList(values, selected) {
  return values.map(value => {
    const cls = selected.has(value) ? "credit-token selected-credit" : "credit-token";
    return `<span class="${cls}">${escapeHtml(value)}</span>`;
  }).join(`<span class="credit-separator">, </span>`);
}

function renderActiveFilters() {
  const items = [];
  if (state.search) items.push({ group: "Search", category: "search", value: state.search });
  for (const [category, label] of [["genre", "Genre"], ["actor", "Actor"], ["director", "Director"]]) {
    for (const value of state.selected[category]) items.push({ group: label, category, value });
  }

  els.activeFilters.innerHTML = items.map(item => `
    <span class="active-filter-chip">
      <span>${escapeHtml(item.group)}: ${escapeHtml(item.value)}</span>
      <button class="filter-remove" type="button" data-category="${item.category}" data-value="${escapeHtml(item.value)}" aria-label="Remove ${escapeHtml(item.group)} filter">×</button>
    </span>`).join("");
}

function activeCount() {
  return state.selected.genre.size + state.selected.actor.size + state.selected.director.size + (state.search ? 1 : 0);
}

function updateCounts() {
  els.filterCount.textContent = String(activeCount());
  els.genreSelectedCount.textContent = String(state.selected.genre.size);
  els.actorSelectedCount.textContent = String(state.selected.actor.size);
  els.directorSelectedCount.textContent = String(state.selected.director.size);
}

function setActivePanel(category) {
  state.activePanel = category;
  document.querySelectorAll("[data-filter-category]").forEach(button => {
    const active = button.dataset.filterCategory === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-filter-panel]").forEach(panel => {
    panel.hidden = panel.dataset.filterPanel !== category;
  });
}

function openFilters() {
  state.lastFocus = document.activeElement;
  state.filtersOpen = true;
  els.filterPanel.classList.add("is-open");
  els.filterBackdrop.hidden = false;
  document.body.classList.add("filters-open");
  syncFilterA11y();
  requestAnimationFrame(() => els.closeFilters.focus());
}

function closeFilters() {
  state.filtersOpen = false;
  els.filterPanel.classList.remove("is-open");
  els.filterBackdrop.hidden = true;
  document.body.classList.remove("filters-open");
  syncFilterA11y();
  if (state.lastFocus?.focus) state.lastFocus.focus();
  state.lastFocus = null;
}

function syncFilterA11y() {
  const visible = DESKTOP_QUERY.matches || state.filtersOpen;
  els.filterPanel.setAttribute("aria-hidden", String(!visible));
  if (DESKTOP_QUERY.matches) {
    els.filterBackdrop.hidden = true;
    document.body.classList.remove("filters-open");
  }
}

function clearFilters() {
  state.search = "";
  state.filterSearch.actor = "";
  state.filterSearch.director = "";
  state.matchMode = { genre: "any", actor: "any", director: "any" };
  for (const set of Object.values(state.selected)) set.clear();

  els.searchInput.value = "";
  els.actorFilterSearch.value = "";
  els.directorFilterSearch.value = "";
  els.genreMatchMode.value = "any";
  els.actorMatchMode.value = "any";
  els.directorMatchMode.value = "any";
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
  els.genreMatchMode.addEventListener("change", event => { state.matchMode.genre = event.target.value; render(); });
  els.actorMatchMode.addEventListener("change", event => { state.matchMode.actor = event.target.value; render(); });
  els.directorMatchMode.addEventListener("change", event => { state.matchMode.director = event.target.value; render(); });
  els.actorFilterSearch.addEventListener("input", event => { state.filterSearch.actor = event.target.value; renderFilterLists(); });
  els.directorFilterSearch.addEventListener("input", event => { state.filterSearch.director = event.target.value; renderFilterLists(); });

  els.clearFilters.addEventListener("click", clearFilters);
  els.reloadData.addEventListener("click", loadSheet);
  els.openFilters.addEventListener("click", openFilters);
  els.closeFilters.addEventListener("click", closeFilters);
  els.applyFilters.addEventListener("click", closeFilters);
  els.filterBackdrop.addEventListener("click", closeFilters);

  els.activeFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-category]");
    if (button) removeFilter(button.dataset.category, button.dataset.value);
  });

  document.querySelectorAll("[data-filter-category]").forEach(button => {
    button.addEventListener("click", () => setActivePanel(button.dataset.filterCategory));
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.filtersOpen) closeFilters();
  });

  if (DESKTOP_QUERY.addEventListener) DESKTOP_QUERY.addEventListener("change", syncFilterA11y);
  else DESKTOP_QUERY.addListener(syncFilterA11y);
}

cacheEls();
bindEvents();
setActivePanel(state.activePanel);
syncFilterA11y();
loadSheet();
