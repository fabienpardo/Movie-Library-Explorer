import { OPTION_COUNTS_CACHE_LIMIT, categories, categoryKeys } from "./config.mjs";
import { state } from "./state.mjs";
import { normalize } from "./utils.mjs";
import { cell, listFor, sagaName } from "./data.mjs";

export function clearOptionCountsCache() {
  state.optionCountsCache.clear();
}

export function matchesList(values, selected, mode) {
  const wanted = [...selected];
  if (!wanted.length) return true;
  return mode === "all" ? wanted.every(value => values.includes(value)) : wanted.some(value => values.includes(value));
}

// The source spreadsheet always ships the same, known set of columns, so the searchable
// fields are an explicit allow-list rather than "every column". Any other column (notes,
// poster/IMDb URLs, synthetic ids) is deliberately excluded so it cannot pollute matches.
// Regression test: "search is scoped to fixed metadata fields and ignores other columns".
export const SEARCH_FIELDS = ["title", "originalTitle", "genres", "year", "releaseDate", "country", "actors", "directors", "saga"];

function rowSearchText(row) {
  // Row contents are immutable after load, so the normalized search blob is memoized per row.
  if (row.__searchText === undefined) {
    row.__searchText = normalize(SEARCH_FIELDS.map(field => cell(row, field)).join(" "));
  }
  return row.__searchText;
}
function matchesSearch(row) {
  const query = normalize(state.search);
  // No searchable tokens in the query. Whitespace-only input is "no filter" (match all),
  // but punctuation/emoji-only input (e.g. "!!!") is a real query with nothing to match.
  if (!query) return !String(state.search || "").trim();
  return rowSearchText(row).includes(query);
}
function matchesSaga(row) {
  // Single-valued filter set by clicking a franchise badge; a movie matches when its saga is one of the selected ones.
  const selected = state.selected.saga;
  if (!selected || !selected.size) return true;
  const name = sagaName(row);
  return name ? selected.has(name) : false;
}
export function matchesFilters(row, skipCategory = null) {
  return matchesSearch(row)
    && (skipCategory === "saga" || matchesSaga(row))
    && categoryKeys.every(category => (
      category === skipCategory || matchesList(listFor(row, category), state.selected[category], state.matchMode[category])
    ));
}
export function filteredRows() { return state.rows.filter(row => matchesFilters(row)); }

// Saga is single-valued and multi-select OR, so its option counts always skip the
// saga selection itself (like "any" mode for the list categories) to avoid dead-ends.
export function sagaOptionCounts() {
  if (!state.columns.saga) return [];
  const counts = new Map();
  for (const row of state.rows.filter(item => matchesFilters(item, "saga"))) {
    const name = sagaName(row);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const value of state.selected.saga || []) if (!counts.has(value)) counts.set(value, 0);
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

function optionCountsCacheKey(category) {
  return JSON.stringify({
    category,
    search: state.search,
    matchMode: state.matchMode,
    selected: categoryKeys.map(key => [key, [...state.selected[key]].sort()]),
    saga: [...(state.selected.saga || [])].sort()
  });
}

export function baseOptionCounts(category) {
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
  while (state.optionCountsCache.size > OPTION_COUNTS_CACHE_LIMIT) {
    state.optionCountsCache.delete(state.optionCountsCache.keys().next().value);
  }
  return sorted;
}

export function optionCounts(category) {
  const term = normalize(state.filterSearch[category] || "");
  return baseOptionCounts(category).filter(([value]) => !term || normalize(value).includes(term));
}

export function activeFilters() {
  return [
    ...(state.search ? [{ group: "Recherche", category: "search", value: state.search }] : []),
    ...[...(state.selected.saga || [])].map(value => ({ group: "Saga", category: "saga", value })),
    ...categoryKeys.flatMap(category => [...state.selected[category]].map(value => ({ group: categories[category].label, category, value })))
  ];
}
export function activeCount() { return activeFilters().length; }
