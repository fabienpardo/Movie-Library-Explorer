import {
  DEFAULT_MATCH_MODE,
  DESKTOP_QUERY,
  SHEET_CSV_URL,
  TEST_FIXTURE_CSV_URL,
  TEST_MISSING_CSV_URL,
  categories,
  categoryKeys,
  searchableCategories,
  COLUMNS,
  INITIAL_VISIBLE_MOVIES,
  LOAD_MORE_MOVIES,
  LOAD_TIMEOUT_MS
} from "./config.mjs";
import { cardNodeCache, els, loadPersistentState, state } from "./state.mjs";
import { decodeFilterValue } from "./utils.mjs";
import { assignUniqueMovieIds, csvToTable, reconcilePersistedSelection } from "./data.mjs";
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
  moveSelectionItemByKeyboard,
  removeSelectionItem,
  renderSelectionPanel,
  syncSelectionCount,
  trapSelectionFocus,
  toggleMovieSelectionById,
  toggleSelectionDetail,
  toggleSelectionPanel
} from "./selection.mjs";
import { initSelectionGestures } from "./selection-gestures.mjs";

// A rebuild-on-render (filter checkbox, card filter button, active-filter chip) can
// leave focus stranded on <body>. Capture a stable descriptor of the focused control
// before rendering and restore it — or the next logical control — afterward.
function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
}
function captureFocusKey() {
  const el = document.activeElement;
  if (!el || el === document.body || typeof el.closest !== "function") return null;

  const cardFilter = el.closest("button[data-card-filter-category]");
  if (cardFilter) {
    const card = cardFilter.closest("[data-movie-id]");
    return { kind: "card-filter", movieId: card?.dataset.movieId, category: cardFilter.dataset.cardFilterCategory, value: cardFilter.dataset.cardFilterValue };
  }
  if (el.matches("input[type='checkbox']")) {
    const list = el.closest("[id]");
    return { kind: "filter-checkbox", listId: list?.id, value: el.value };
  }
  const activeChip = el.closest("button[data-filter-category]");
  if (activeChip) {
    const chips = [...els.activeFilters.querySelectorAll("button[data-filter-category]")];
    return { kind: "active-filter", index: chips.indexOf(activeChip) };
  }
  return null;
}
function restoreFocusKey(key) {
  if (!key) return;
  let target = null;
  if (key.kind === "card-filter" && key.movieId) {
    target = els.movieGrid.querySelector(`[data-movie-id="${cssEscape(key.movieId)}"] button[data-card-filter-category="${key.category}"][data-card-filter-value="${cssEscape(key.value)}"]`);
  } else if (key.kind === "filter-checkbox" && key.listId) {
    target = document.getElementById(key.listId)?.querySelector(`input[type='checkbox'][value="${cssEscape(key.value)}"]`);
  } else if (key.kind === "active-filter") {
    const chips = [...els.activeFilters.querySelectorAll("button[data-filter-category]")];
    target = chips[key.index] || chips[key.index - 1] || els.clearFilters;
  }
  target?.focus?.();
}
function renderPreservingFocus() {
  const key = captureFocusKey();
  render();
  restoreFocusKey(key);
}

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
    "backToTop", "loadMore", "genreMatchMode", "actorMatchMode", "directorMatchMode",
    "sagaList", "sagaSelectedCount", "selectionBackdrop"
  ].forEach(id => { els[id] = byId(id); });

  for (const cfg of Object.values(categories)) {
    els[cfg.listId] = byId(cfg.listId);
    els[cfg.countId] = byId(cfg.countId);
    if (cfg.searchId) els[cfg.searchId] = byId(cfg.searchId);
  }
}

function resetData() {
  Object.assign(state, { rows: [], labels: [], columns: {}, warnings: [], visibleMovieLimit: INITIAL_VISIBLE_MOVIES });
  clearOptionCountsCache();
  state.sagaTotalsCache = null;
}
function resetFilters() {
  Object.assign(state, {
    search: "",
    filterSearch: { actor: "", director: "" },
    matchMode: { ...DEFAULT_MATCH_MODE },
    activePanel: "genre",
    visibleMovieLimit: INITIAL_VISIBLE_MOVIES
  });
  for (const selected of Object.values(state.selected)) selected.clear();
  clearOptionCountsCache();
}
function resetVisibleMovies() {
  state.visibleMovieLimit = INITIAL_VISIBLE_MOVIES;
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
  if (els.loadMore) els.loadMore.hidden = true;
}

// Guard against overlapping reloads: rapid "Recharger" clicks (or a viewport change
// that triggers a reload mid-flight) each start their own fetch, and every completion
// mutates shared global state. We abort the in-flight request when a newer one starts
// and stamp each attempt with a monotonic generation, so only the latest request is
// ever allowed to commit success OR failure to the UI.
let activeLoadController = null;
let loadGeneration = 0;

export async function loadSheet() {
  showLoading();
  const sourceUrl = dataSourceUrl();
  const generation = ++loadGeneration;
  if (activeLoadController) activeLoadController.abort();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  activeLoadController = controller;
  const timeoutId = controller ? setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS) : null;
  const isStale = () => generation !== loadGeneration;

  try {
    const response = await fetch(sourceUrl, { cache: "no-store", signal: controller?.signal });
    if (isStale()) return;
    if (!response.ok) throw new Error(`Impossible de charger le point d’accès CSV. HTTP ${response.status}.`);

    const text = await response.text();
    if (isStale()) return;
    if (/<!doctype html|<html[\s>]/i.test(text)) throw new Error("Google a renvoyé du HTML au lieu du CSV. Vérifiez que l’onglet est toujours publié.");

    const { labels, rows } = csvToTable(text);
    const usableRows = rows
      .filter(row => Object.values(row).some(value => String(value || "").trim()))
      .map(row => ({ ...row }));
    const idWarnings = assignUniqueMovieIds(usableRows, COLUMNS);
    Object.assign(state, {
      labels,
      rows: usableRows,
      columns: COLUMNS,
      warnings: idWarnings,
      visibleMovieLimit: INITIAL_VISIBLE_MOVIES
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
    if (isStale()) return;
    resetAfterLoadFailure();
    const message = error.name === "AbortError"
      ? "Le chargement des données a expiré. Vérifiez votre connexion, puis réessayez."
      : `${error.message}\n\nSource: ${sourceUrl || dataSourceUrl()}`;
    showError(message);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (activeLoadController === controller) activeLoadController = null;
  }
}

function showLoading() {
  els.status.hidden = false;
  els.status.textContent = "Chargement de la bibliothèque…";
  els.resultSummary.hidden = true;
  els.diagnostics.hidden = true;
  if (els.loadMore) els.loadMore.hidden = true;
  els.movieGrid.replaceChildren();
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Chargement…"; });
}
function showError(message) {
  els.status.hidden = false;
  replaceChildren(els.status, [createElement("span", { className: "error", text: message })]);
  els.resultSummary.hidden = true;
  if (els.loadMore) els.loadMore.hidden = true;
  els.movieGrid.replaceChildren();
  categoryKeys.forEach(category => { els[categories[category].listId].textContent = "Aucune donnée chargée"; });
}

function renderLoadMore(visibleCount, totalCount) {
  if (!els.loadMore) return;
  const remaining = Math.max(0, totalCount - visibleCount);
  els.loadMore.hidden = remaining === 0;
  els.loadMore.disabled = remaining === 0;
  els.loadMore.setAttribute("aria-label", remaining ? `Afficher ${Math.min(LOAD_MORE_MOVIES, remaining)} films de plus` : "Tous les films sont affichés");
}

function render() {
  // The option-counts cache is keyed on every input that affects it (search/matchMode/selected) and is
  // cleared on data/filter resets, so it can safely persist across renders instead of being wiped each time.
  const rows = sortRows(filteredRows());
  const visibleRows = rows.slice(0, state.visibleMovieLimit);

  els.status.hidden = true;
  renderResultSummary(visibleRows, rows.length);
  updateFilterResultCount(rows.length);
  renderActiveFilters();
  renderFilterLists();
  syncSelectionCount();
  renderSelectionPanel();
  renderGrid(visibleRows);
  renderLoadMore(visibleRows.length, rows.length);
  requestAnimationFrame(() => { updateBackToTopMetrics(); syncBackToTop(); });
}

function setFilterSelection(category, value, selected) {
  state.selected[category][selected ? "add" : "delete"](value);
  resetVisibleMovies();
  renderPreservingFocus();
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
  // resetFilters sets state.activePanel back to "genre"; sync the DOM so a visible
  // Actor/Saga panel doesn't stay shown while state reports Genre.
  setActivePanel(state.activePanel);
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
  resetVisibleMovies();
  renderPreservingFocus();
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
  els.searchInput.addEventListener("input", event => { state.search = event.target.value; resetVisibleMovies(); render(); });
  els.sortSelect.addEventListener("change", event => { state.sort = event.target.value; resetVisibleMovies(); render(); });
  els.toggleSelectionPanel.addEventListener("click", toggleSelectionPanel);
  categoryKeys.forEach(category => {
    const group = byId(`${category}MatchMode`);
    group.addEventListener("click", event => {
      const option = event.target.closest("[data-match-value]");
      if (!option || !group.contains(option)) return;
      if (state.matchMode[category] === option.dataset.matchValue) return;
      state.matchMode[category] = option.dataset.matchValue;
      resetVisibleMovies();
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

  els.loadMore.addEventListener("click", () => {
    state.visibleMovieLimit += LOAD_MORE_MOVIES;
    render();
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
      removeSelectionItem(removeButton.dataset.selectionRemoveId);
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
  // Keyboard reorder: Arrow Up/Down on a drag handle moves that item and keeps focus on it.
  els.selectionPanel.addEventListener("keydown", event => {
    const handle = event.target.closest("button[data-selection-move-id]");
    if (!handle || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveSelectionItemByKeyboard(handle.dataset.selectionMoveId, event.key === "ArrowUp" ? -1 : 1);
  });
  initSelectionGestures();
  document.querySelectorAll(".filter-jump-nav__button[data-filter-category]").forEach(button => button.addEventListener("click", () => setActivePanel(button.dataset.filterCategory)));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.filtersOpen) closeFilters();
    if (event.key === "Escape" && state.selectionPanelOpen) closeSelectionPanel();
    trapFilterFocus(event);
    trapSelectionFocus(event);
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
