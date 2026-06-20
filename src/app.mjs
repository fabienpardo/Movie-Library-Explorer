import {
  DEFAULT_MATCH_MODE,
  DESKTOP_QUERY,
  SHEET_CSV_URL,
  TEST_FIXTURE_CSV_URL,
  TEST_MISSING_CSV_URL,
  categories,
  categoryKeys,
  searchableCategories,
  COLUMNS
} from "./config.mjs";
import { cardNodeCache, els, loadPersistentState, state } from "./state.mjs";
import { decodeFilterValue } from "./utils.mjs";
import { csvToTable, makeMovieId, reconcilePersistedSelection } from "./data.mjs";
import { sortRows } from "./sorting.mjs";
import { byId, createElement, replaceChildren } from "./dom.mjs";
import { clearOptionCountsCache, filteredRows } from "./matching.mjs";
import { handlePosterError, handlePosterLoad, renderGrid } from "./render-cards.mjs";
import {
  renderActiveFilters,
  renderDiagnostics,
  renderFilterLists,
  renderResultSummary,
  syncControls,
  syncMatchMode,
  updateFilterResultCount
} from "./render-filters.mjs";
import {
  closeFilters,
  openFilters,
  scrollToTop,
  setActivePanel,
  setFilterSearchFocus,
  syncBackToTop,
  updateBackToTopMetrics,
  syncFilterA11y,
  trapFilterFocus
} from "./filter-panel.mjs";
import {
  clearSelection,
  closeSelectionPanel,
  renderSelectionPanel,
  syncSelectionCount,
  toggleMovieSelectionById,
  toggleSelectionDetail,
  toggleSelectionPanel
} from "./selection.mjs";

export function dataSourceUrl() {
  const fixtureMode = window.MOVIE_EXPLORER_TEST_FIXTURE_MODE || new URLSearchParams(window.location.search).get("fixture");
  if (fixtureMode === "1") return TEST_FIXTURE_CSV_URL;
  if (fixtureMode === "missing") return TEST_MISSING_CSV_URL;
  return SHEET_CSV_URL;
}
function cacheEls() {
  [
    "status", "diagnostics", "resultSummary", "movieGrid", "activeFilters", "selectionPanel", "filterPanel", "filterBackdrop",
    "openFilters", "closeFilters", "applyFilters", "clearFilters", "reloadData", "filterCount",
    "searchInput", "sortSelect", "toggleSelectionPanel", "selectionCount",
    "backToTop", "genreMatchMode", "actorMatchMode", "directorMatchMode",
    "sagaList", "sagaSelectedCount", "selectionBackdrop"
  ].forEach(id => { els[id] = byId(id); });

  for (const cfg of Object.values(categories)) {
    els[cfg.listId] = byId(cfg.listId);
    els[cfg.countId] = byId(cfg.countId);
    if (cfg.searchId) els[cfg.searchId] = byId(cfg.searchId);
  }
}

function resetData() {
  Object.assign(state, { rows: [], labels: [], columns: {}, warnings: [] });
  clearOptionCountsCache();
  state.sagaTotalsCache = null;
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
export function resetAfterLoadFailure() {
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

export async function loadSheet() {
  showLoading();
  const sourceUrl = dataSourceUrl();

  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Impossible de charger le point d’accès CSV. HTTP ${response.status}.`);

    const text = await response.text();
    if (/<!doctype html|<html[\s>]/i.test(text)) throw new Error("Google a renvoyé du HTML au lieu du CSV. Vérifiez que l’onglet est toujours publié.");

    const { labels, rows } = csvToTable(text);
    const usableRows = rows
      .filter(row => Object.values(row).some(value => String(value || "").trim()))
      .map((row, index) => ({ ...row, __movieExplorerId: makeMovieId(row, index, COLUMNS) }));
    Object.assign(state, {
      labels,
      rows: usableRows,
      columns: COLUMNS,
      warnings: []
    });
    // showLoading() already emptied the grid and this clears the reuse pool, so
    // renderGrid rebuilds every card from the freshly loaded rows (no stale reuse).
    cardNodeCache.clear();
    // The counts cache key omits rows/columns, so invalidate it whenever a new dataset is loaded.
    clearOptionCountsCache();
    state.sagaTotalsCache = null;
    reconcilePersistedSelection(usableRows, COLUMNS);

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
  els.movieGrid.replaceChildren();
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Chargement…"; });
}
function showError(message) {
  els.status.hidden = false;
  replaceChildren(els.status, [createElement("span", { className: "error", text: message })]);
  els.resultSummary.hidden = true;
  els.movieGrid.replaceChildren();
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Aucune donnée chargée"; });
}

function render() {
  // The option-counts cache is keyed on every input that affects it (search/matchMode/selected) and is
  // cleared on data/filter resets, so it can safely persist across renders instead of being wiped each time.
  const rows = sortRows(filteredRows());

  els.status.hidden = true;
  renderResultSummary(rows);
  updateFilterResultCount(rows.length);
  renderActiveFilters();
  renderFilterLists();
  syncSelectionCount();
  renderSelectionPanel();
  renderGrid(rows);
  requestAnimationFrame(() => { updateBackToTopMetrics(); syncBackToTop(); });
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

export function clearFilters() {
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

function handleFilterViewportChange() {
  if (DESKTOP_QUERY.matches && state.filtersOpen) {
    // Mirror closeFilters' teardown: the mobile trigger that opened the drawer is
    // hidden on desktop, so drop the searching state and stale focus reference
    // rather than trying to restore focus to a now-hidden control.
    setFilterSearchFocus(false);
    state.filtersOpen = false;
    state.lastFocus = null;
    els.filterPanel.classList.remove("is-open");
    els.filterBackdrop.hidden = true;
    document.body.classList.remove("filters-open");
  }
  syncFilterA11y();
  if (state.rows.length) render();
  else syncBackToTop();
}

// The header is sticky; publish its height so sticky elements below it (the
// result summary) can pin just underneath instead of being hidden behind it.
function syncHeaderHeight() {
  const header = document.querySelector(".app-header");
  if (!header) return;
  document.documentElement.style.setProperty("--app-header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
}

function bindEvents() {
  els.searchInput.addEventListener("input", event => { state.search = event.target.value; render(); });
  els.sortSelect.addEventListener("change", event => { state.sort = event.target.value; render(); });
  els.toggleSelectionPanel.addEventListener("click", toggleSelectionPanel);
  categoryKeys.forEach(category => {
    const group = byId(`${category}MatchMode`);
    group.addEventListener("click", event => {
      const option = event.target.closest("[data-match-value]");
      if (!option || !group.contains(option)) return;
      if (state.matchMode[category] === option.dataset.matchValue) return;
      state.matchMode[category] = option.dataset.matchValue;
      syncMatchMode(category);
      render();
    });
  });

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

  // Saga is single-valued (OR-only) and has no match toggle, so it is bound on its
  // own rather than via the categoryKeys loop above.
  els.sagaList.addEventListener("change", event => {
    if (event.target.matches("input[type='checkbox']")) setFilterSelection("saga", event.target.value, event.target.checked);
  });

  els.movieGrid.addEventListener("error", handlePosterError, true);
  els.selectionPanel.addEventListener("error", handlePosterError, true);
  els.movieGrid.addEventListener("load", handlePosterLoad, true);
  els.selectionPanel.addEventListener("load", handlePosterLoad, true);

  els.movieGrid.addEventListener("click", event => {
    if (event.target.closest("button[data-empty-clear]")) {
      clearFilters();
      return;
    }

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
  els.selectionBackdrop.addEventListener("click", closeSelectionPanel);
  els.backToTop.addEventListener("click", scrollToTop);
  // Coalesce scroll events to one rAF: syncBackToTop only reads scrollY + a cached
  // flag, so a passive rAF-throttled handler keeps scrolling off the layout path.
  let scrollRaf = 0;
  window.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; syncBackToTop(); });
  }, { passive: true });
  window.addEventListener("resize", () => { syncHeaderHeight(); updateBackToTopMetrics(); syncBackToTop(); }, { passive: true });

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

    if (event.target.closest("button[data-selection-action='close']")) { closeSelectionPanel(); return; }
    if (event.target.closest("button[data-selection-action='clear']")) clearSelection();
  });
  document.querySelectorAll(".filter-jump-nav__button[data-filter-category]").forEach(button => button.addEventListener("click", () => setActivePanel(button.dataset.filterCategory)));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.filtersOpen) closeFilters();
    if (event.key === "Escape" && state.selectionPanelOpen) closeSelectionPanel();
    trapFilterFocus(event);
  });

  if (DESKTOP_QUERY.addEventListener) DESKTOP_QUERY.addEventListener("change", handleFilterViewportChange);
  else DESKTOP_QUERY.addListener(handleFilterViewportChange);
}

export function initApp() {
  cacheEls();
  loadPersistentState();
  syncControls();
  bindEvents();
  setActivePanel(state.activePanel);
  syncFilterA11y();
  syncSelectionCount();
  syncBackToTop();
  syncHeaderHeight();
  loadSheet();
}
