// Single home for the test surface. Importing the hook functions here (instead of in app.mjs)
// keeps the app module free of imports-that-exist-only-for-tests. Dependency is one-directional
// (test-hooks -> app + modules), so there is no import cycle.
import { categories, columnAliases } from "./config.mjs";
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
  cell,
  csvToTable,
  detectColumns,
  displayOriginalTitle,
  displayTitle,
  equivalentTitle,
  fallbackMovieId,
  isMovieSelected,
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
import { effectiveViewMode, movieViewModel, ratingClass, syncDisplaySettings } from "./render-cards.mjs";
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
    escapeHtml,
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
    ratingClass,
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
