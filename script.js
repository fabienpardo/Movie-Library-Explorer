// Published Google Sheet source.
// The /d/e/2PACX... published id does not work with /gviz/tq.
// This app reads the published CSV endpoint instead.
const PUBLISHED_SHEET_ID = "2PACX-1vR0f-YQic-WwbzgTdFQroIy9T1P14usd5ysqySDfuM0Hi9JtMS8jKJ1DaJBJOQAgXvkWpgTXjiCMTdK";
const GID = "70337195";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?gid=${GID}&single=true&output=csv`;

const state = {
  rows: [],
  columns: {},
  selectedGenres: new Set(),
  selectedActors: new Set(),
  selectedDirectors: new Set(),
  search: "",
  actorListSearch: "",
  directorListSearch: "",
  sort: "title-asc",
  matchMode: "any"
};

const titleAliases = ["title", "movie", "movie title", "name"];
const originalTitleAliases = ["original title", "originaltitle", "original name", "original movie title"];
const genreAliases = ["genre", "genres"];
const runtimeAliases = [
  "runtime",
  "runtime min",
  "runtime mins",
  "runtime minutes",
  "duration",
  "duration min",
  "duration mins",
  "duration minutes",
  "running time"
];
const yearAliases = ["year", "release year", "movie year"];
const imdbRatingAliases = ["imdb rating", "imdb", "imdb score", "imdb rate", "imdb user rating"];
const countryAliases = [
  "country",
  "countries",
  "production country",
  "production countries",
  "main country",
  "origin country",
  "country of origin",
  "nationality"
];
const actorAliases = ["actor", "actors", "cast", "main cast", "stars", "starring", "lead actors"];
const directorAliases = ["director", "directors", "directed by"];

const $ = (id) => document.getElementById(id);

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectColumns(labels) {
  const normalizedLabels = labels.map(label => ({ raw: label, norm: normalizeKey(label) }));
  const pick = (aliases, options = {}) => {
    const normalizedAliases = aliases.map(normalizeKey);
    const exclusions = (options.exclude || []).map(normalizeKey);
    const candidates = normalizedLabels.filter(label => !exclusions.some(exclusion => label.norm === exclusion || label.norm.includes(exclusion)));

    const exact = candidates.find(label => normalizedAliases.includes(label.norm));
    if (exact) return exact.raw;

    const partial = candidates.find(label => normalizedAliases.some(alias => label.norm.includes(alias)));
    return partial ? partial.raw : null;
  };

  return {
    title: pick(titleAliases, { exclude: ["original title"] }) || labels[0],
    originalTitle: pick(originalTitleAliases),
    genres: pick(genreAliases),
    runtime: pick(runtimeAliases),
    year: pick(yearAliases),
    imdbRating: pick(imdbRatingAliases),
    country: pick(countryAliases),
    actors: pick(actorAliases),
    directors: pick(directorAliases)
  };
}

function getValue(row, columnName) {
  if (!columnName) return "";
  return row[columnName] ?? "";
}

function parseDelimited(value) {
  return String(value || "")
    .split(/[,;|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseCredits(value) {
  return String(value || "")
    .split(/[,;|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function getMainCountry(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.split(/[,;|/]/).map(item => item.trim()).filter(Boolean)[0] || raw;
}

function parseRuntime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return Number.NaN;

  const hourMinute = raw.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0);

  const colon = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const minutes = raw.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?/i);
  if (minutes) return Number(minutes[1]);

  return Number.NaN;
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : Number.NaN;
}

function formatRuntime(minutes) {
  if (!Number.isFinite(minutes)) return "Runtime unknown";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter(items => items.some(item => String(item || "").trim() !== ""));
}

function parseCsvTable(csvText) {
  const records = parseCsv(csvText);
  if (records.length < 2) throw new Error("The CSV endpoint returned no usable rows.");

  const labels = records[0].map((label, index) => {
    const clean = String(label || "").trim();
    return clean || `Column ${index + 1}`;
  });

  const rows = records.slice(1).map(record => {
    const output = {};
    labels.forEach((label, index) => {
      output[label] = record[index] ?? "";
    });
    return output;
  });

  return { labels, rows };
}

async function loadSheet() {
  $("status").textContent = "Loading movie library…";
  $("movieGrid").innerHTML = "";
  setFilterListLoading();

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load the published CSV endpoint. HTTP ${response.status}.`);

    const csvText = await response.text();
    if (/<!doctype html|<html[\s>]/i.test(csvText)) {
      throw new Error("The Google endpoint returned HTML instead of CSV. Re-publish the tab as CSV or use a normally shared Google Sheet URL with a real spreadsheet ID.");
    }

    const { labels, rows } = parseCsvTable(csvText);
    state.rows = rows.filter(row => Object.values(row).some(value => String(value || "").trim() !== ""));
    state.columns = detectColumns(labels);

    if (!state.columns.genres) throw new Error('Could not detect a genre column. Rename your genre column to "Genres" or update genreAliases in script.js.');
    if (!state.columns.runtime) console.warn("Could not detect a runtime column. Runtime sorting will put unknown values last.");
    if (!state.columns.imdbRating) console.warn("Could not detect an IMDb rating column. IMDb sorting will put unknown values last.");
    if (!state.columns.actors) console.warn("Could not detect an actors column. Actor filter will be empty.");
    if (!state.columns.directors) console.warn("Could not detect a directors column. Director filter will be empty.");

    renderFilterLists();
    render();
  } catch (error) {
    showError(`${error.message}\n\nSource used: ${SHEET_CSV_URL}\n\nIf this is a CORS or network error, run the app through a local server first. If it still fails, the most stable fix is to share the original Google Sheet as 'Anyone with the link can view' and use its /d/<real-spreadsheet-id>/gviz/tq endpoint.`);
  }
}

function setFilterListLoading() {
  $("genreList").textContent = "Loading…";
  $("actorList").textContent = "Loading…";
  $("directorList").textContent = "Loading…";
}

function showError(message) {
  $("status").innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  $("genreList").textContent = "No genres loaded";
  $("actorList").textContent = "No actors loaded";
  $("directorList").textContent = "No directors loaded";
  $("movieGrid").innerHTML = "";
}

function getValueCounts(columnName, parser) {
  if (!columnName) return [];
  const counts = new Map();
  for (const row of state.rows) {
    const values = parser(getValue(row, columnName));
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function filterCountsBySearch(counts, searchValue) {
  const search = normalizeKey(searchValue);
  if (!search) return counts;
  return counts.filter(([value]) => normalizeKey(value).includes(search));
}

function renderFilterLists() {
  renderCheckboxFilter({
    elementId: "genreList",
    counts: getValueCounts(state.columns.genres, parseDelimited),
    selectedSet: state.selectedGenres,
    emptyLabel: "No genres loaded",
    onChange: render
  });

  renderCheckboxFilter({
    elementId: "actorList",
    counts: filterCountsBySearch(getValueCounts(state.columns.actors, parseCredits), state.actorListSearch),
    selectedSet: state.selectedActors,
    emptyLabel: state.columns.actors ? "No actors match the list search" : "No actors column detected",
    onChange: render
  });

  renderCheckboxFilter({
    elementId: "directorList",
    counts: filterCountsBySearch(getValueCounts(state.columns.directors, parseCredits), state.directorListSearch),
    selectedSet: state.selectedDirectors,
    emptyLabel: state.columns.directors ? "No directors match the list search" : "No directors column detected",
    onChange: render
  });
}

function renderCheckboxFilter({ elementId, counts, selectedSet, emptyLabel, onChange }) {
  const container = $(elementId);
  if (!counts.length) {
    container.textContent = emptyLabel;
    return;
  }

  container.innerHTML = counts.map(([value, count]) => `
    <label class="filter-option">
      <input type="checkbox" value="${escapeHtml(value)}" ${selectedSet.has(value) ? "checked" : ""} />
      <span>${escapeHtml(value)}</span>
      <small>${count}</small>
    </label>
  `).join("");

  container.querySelectorAll("input[type='checkbox']").forEach(input => {
    input.addEventListener("change", (event) => {
      const value = event.target.value;
      if (event.target.checked) selectedSet.add(value);
      else selectedSet.delete(value);
      onChange();
    });
  });
}

function collectionMatches(rowValues, selectedValues) {
  const selected = [...selectedValues];
  if (selected.length === 0) return true;
  if (state.matchMode === "all") return selected.every(value => rowValues.includes(value));
  return selected.some(value => rowValues.includes(value));
}

function getFilteredRows() {
  const search = normalizeKey(state.search);

  return state.rows.filter(row => {
    const genres = parseDelimited(getValue(row, state.columns.genres));
    const actors = parseCredits(getValue(row, state.columns.actors));
    const directors = parseCredits(getValue(row, state.columns.directors));

    const genreMatch = collectionMatches(genres, state.selectedGenres);
    const actorMatch = collectionMatches(actors, state.selectedActors);
    const directorMatch = collectionMatches(directors, state.selectedDirectors);
    const searchMatch = !search || normalizeKey(Object.values(row).join(" ")).includes(search);

    return genreMatch && actorMatch && directorMatch && searchMatch;
  });
}

function sortRows(rows) {
  const [field, direction] = state.sort.split("-");
  const multiplier = direction === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    if (field === "runtime") {
      return compareNumbers(parseRuntime(getValue(a, state.columns.runtime)), parseRuntime(getValue(b, state.columns.runtime)), multiplier);
    }
    if (field === "year") {
      return compareNumbers(parseNumber(getValue(a, state.columns.year)), parseNumber(getValue(b, state.columns.year)), multiplier);
    }
    if (field === "imdbRating") {
      return compareNumbers(parseNumber(getValue(a, state.columns.imdbRating)), parseNumber(getValue(b, state.columns.imdbRating)), multiplier);
    }
    if (field === "originalTitle") {
      return compareText(getDisplayOriginalTitle(a), getDisplayOriginalTitle(b), multiplier);
    }
    if (field === "country") {
      return compareText(getMainCountry(getValue(a, state.columns.country)), getMainCountry(getValue(b, state.columns.country)), multiplier);
    }
    return compareText(getValue(a, state.columns.title), getValue(b, state.columns.title), multiplier);
  });
}

function compareNumbers(a, b, multiplier) {
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return (a - b) * multiplier;
}

function compareText(a, b, multiplier) {
  const aText = String(a || "").trim();
  const bText = String(b || "").trim();
  if (!aText && !bText) return 0;
  if (!aText) return 1;
  if (!bText) return -1;
  return aText.localeCompare(bText) * multiplier;
}

function getDisplayTitle(row) {
  return getValue(row, state.columns.title) || getValue(row, state.columns.originalTitle) || "Untitled";
}

function getDisplayOriginalTitle(row) {
  const originalTitle = getValue(row, state.columns.originalTitle);
  const title = getValue(row, state.columns.title);
  return originalTitle && originalTitle !== title ? originalTitle : "";
}

function render() {
  const filtered = sortRows(getFilteredRows());
  const totalRuntime = filtered.reduce((sum, row) => {
    const runtime = parseRuntime(getValue(row, state.columns.runtime));
    return Number.isFinite(runtime) ? sum + runtime : sum;
  }, 0);

  $("status").innerHTML = `
    <span>${filtered.length} / ${state.rows.length} movies</span>
    <span>${formatRuntime(totalRuntime)} total runtime</span>
  `;

  renderActiveFilters();

  if (filtered.length === 0) {
    $("movieGrid").innerHTML = `<div class="empty">No movies match the current filters.</div>`;
    return;
  }

  $("movieGrid").innerHTML = filtered.map(row => {
    const title = getDisplayTitle(row);
    const originalTitle = getDisplayOriginalTitle(row);
    const year = getValue(row, state.columns.year);
    const imdbRating = getValue(row, state.columns.imdbRating);
    const runtime = parseRuntime(getValue(row, state.columns.runtime));
    const country = getMainCountry(getValue(row, state.columns.country));
    const genres = parseDelimited(getValue(row, state.columns.genres));
    const actors = parseCredits(getValue(row, state.columns.actors));
    const directors = parseCredits(getValue(row, state.columns.directors));

    const metaItems = [
      year ? `Year: ${escapeHtml(year)}` : null,
      country ? `Country: ${escapeHtml(country)}` : null,
      `Runtime: ${escapeHtml(formatRuntime(runtime))}`,
      imdbRating ? `IMDb rating: ${escapeHtml(imdbRating)}` : null
    ].filter(Boolean);

    return `
      <article class="card">
        <h2>${escapeHtml(title)}</h2>
        ${originalTitle ? `<div class="original-title">Original title: ${escapeHtml(originalTitle)}</div>` : ""}
        <div class="meta">${metaItems.join("<br>")}</div>
        ${directors.length ? `<div class="credit-line"><strong>Director:</strong> ${escapeHtml(directors.slice(0, 3).join(", "))}${directors.length > 3 ? "…" : ""}</div>` : ""}
        ${actors.length ? `<div class="credit-line"><strong>Actors:</strong> ${escapeHtml(actors.slice(0, 4).join(", "))}${actors.length > 4 ? "…" : ""}</div>` : ""}
        <div class="chips">
          ${genres.map(genre => `<span class="chip">${escapeHtml(genre)}</span>`).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderActiveFilters() {
  const pills = [
    ...[...state.selectedGenres].map(value => ({ group: "Genre", value })),
    ...[...state.selectedActors].map(value => ({ group: "Actor", value })),
    ...[...state.selectedDirectors].map(value => ({ group: "Director", value }))
  ];

  if (!pills.length && !state.search) {
    $("activeFilters").innerHTML = "";
    return;
  }

  const searchPill = state.search ? `<span class="pill pill-muted">Search: ${escapeHtml(state.search)}</span>` : "";
  const filterPills = pills.map(item => `<span class="pill">${escapeHtml(item.group)}: ${escapeHtml(item.value)}</span>`).join("");
  $("activeFilters").innerHTML = searchPill + filterPills;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

$("searchInput").addEventListener("input", event => {
  state.search = event.target.value;
  render();
});

$("sortSelect").addEventListener("change", event => {
  state.sort = event.target.value;
  render();
});

$("matchMode").addEventListener("change", event => {
  state.matchMode = event.target.value;
  render();
});

$("actorFilterSearch").addEventListener("input", event => {
  state.actorListSearch = event.target.value;
  renderFilterLists();
});

$("directorFilterSearch").addEventListener("input", event => {
  state.directorListSearch = event.target.value;
  renderFilterLists();
});

$("clearFilters").addEventListener("click", () => {
  state.selectedGenres.clear();
  state.selectedActors.clear();
  state.selectedDirectors.clear();
  state.search = "";
  state.actorListSearch = "";
  state.directorListSearch = "";
  $("searchInput").value = "";
  $("actorFilterSearch").value = "";
  $("directorFilterSearch").value = "";
  renderFilterLists();
  render();
});

$("reloadData").addEventListener("click", loadSheet);

loadSheet();
