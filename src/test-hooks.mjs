// Single home for the test surface. Importing the hook functions here (instead of in app.mjs)
// keeps the app module free of imports-that-exist-only-for-tests. Dependency is one-directional
// (test-hooks -> app + modules), so there is no import cycle.
import { categories, COLUMNS, INITIAL_VISIBLE_MOVIES, LOAD_MORE_MOVIES } from "./config.mjs";
import { loadPersistentState, resetStorageAvailabilityForTests, state } from "./state.mjs";
import {
  escapeHtml,
  formatRuntime,
  mainCountry,
  normalize,
  parseDateValue,
  parseList,
  parseNumber,
  parseRuntime,
  toSafeDomId
} from "./utils.mjs";
import {
  assignUniqueMovieIds,
  cell,
  csvToTable,
  displayOriginalTitle,
  displayTitle,
  equivalentTitle,
  fallbackMovieId,
  legacyMovieIds,
  listFor,
  makeMovieId,
  movieId,
  movieUrl,
  parseCsv,
  posterUrl,
  reconcilePersistedSelection,
  safeImageUrl,
  sagaName,
  sagaOrder,
  sagaTotal
} from "./data.mjs";
import {
  compare,
  normalizeSortText,
  sortRows,
  sortValue,
  sortableTitle,
  stripLeadingArticle,
  stripSortEdgePunctuation
} from "./sorting.mjs";
import {
  SEARCH_FIELDS,
  activeCount,
  activeFilters,
  baseOptionCounts,
  filteredRows,
  matchesFilters,
  matchesList,
  optionCounts
} from "./matching.mjs";
import { movieViewModel, posterPriorityForIndex, ratingClass } from "./render-cards.mjs";
import { renderResultSummary } from "./render-filters.mjs";
import {
  clearSelection,
  selectedRows,
  syncSelectionCount,
  toggleMovieSelectionById,
  toggleSelectionDetail
} from "./selection.mjs";
import { clearFilters, dataSourceUrl, initApp, loadSheet, resetAfterLoadFailure } from "./app.mjs";

export { initApp };

export function getTestHooks() {
  return {
    activeCount,
    activeFilters,
    assignUniqueMovieIds,
    baseOptionCounts,
    categories,
    cell,
    clearFilters,
    clearSelection,
    COLUMNS,
    compare,
    csvToTable,
    dataSourceUrl,
    displayOriginalTitle,
    displayTitle,
    equivalentTitle,
    escapeHtml,
    loadPersistentState,
    INITIAL_VISIBLE_MOVIES,
    LOAD_MORE_MOVIES,
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
    movieViewModel,
    posterUrl,
    sagaName,
    sagaOrder,
    sagaTotal,
    safeImageUrl,
    normalize,
    normalizeSortText,
    optionCounts,
    parseCsv,
    parseDateValue,
    parseList,
    parseNumber,
    parseRuntime,
    posterPriorityForIndex,
    ratingClass,
    renderResultSummary,
    reconcilePersistedSelection,
    resetStorageAvailabilityForTests,
    resetAfterLoadFailure,
    selectedRows,
    syncSelectionCount,
    toggleMovieSelectionById,
    toggleSelectionDetail,
    toSafeDomId,
    SEARCH_FIELDS,
    sortRows,
    sortValue,
    sortableTitle,
    state,
    stripLeadingArticle,
    stripSortEdgePunctuation
  };
}

export function installTestHooks(targetWindow = window) {
  targetWindow.__MovieExplorerTestHooks = getTestHooks();
  return targetWindow.__MovieExplorerTestHooks;
}
