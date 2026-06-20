import { DESKTOP_QUERY, FOCUSABLE, PANEL_FOCUSABLE, SUPPORTS_INERT } from "./config.mjs";
import { els, state } from "./state.mjs";

export function setActivePanel(category) {
  state.activePanel = category;
  document.querySelectorAll(".filter-jump-nav__button[data-filter-category]").forEach(button => {
    const active = button.dataset.filterCategory === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-filter-panel]").forEach(panel => { panel.hidden = panel.dataset.filterPanel !== category; });
}
export function openFilters() {
  state.lastFocus = document.activeElement;
  state.filtersOpen = true;
  els.filterPanel.classList.add("is-open");
  els.filterBackdrop.hidden = false;
  document.body.classList.add("filters-open");
  syncFilterA11y();
  syncBackToTop();
  // Move focus into the dialog for a11y — but only if it hasn't already landed on a
  // control inside the panel by the time this frame runs. The deferred focus can be
  // delayed a frame or two; without this guard it could steal focus back from a
  // search field the user already tapped (which also broke first-touch selection).
  requestAnimationFrame(() => {
    if (state.filtersOpen && !els.filterPanel.contains(document.activeElement)) els.closeFilters.focus();
  });
}
export function closeFilters() {
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
export function isFilterPanelVisible() {
  return DESKTOP_QUERY.matches || state.filtersOpen;
}
export function syncFilterA11y() {
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

export function syncDynamicFocusableFallback() {
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
export function trapFilterFocus(event) {
  if (event.key !== "Tab" || !state.filtersOpen || DESKTOP_QUERY.matches) return;
  const focusable = focusableFilterControls();
  const first = focusable[0] || els.filterPanel;
  const last = focusable[focusable.length - 1] || els.filterPanel;

  if (!els.filterPanel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
export function setFilterSearchFocus(isFocused) {
  els.filterPanel.classList.toggle("filter-panel--searching", isFocused);
  if (!isFocused) return;
  window.setTimeout(() => {
    if (els.filterPanel.contains(document.activeElement)) document.activeElement.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 80);
}

// Recompute the page-length flag. Reads scrollHeight (a forced layout) so it must
// only run off the scroll hot path — on render and resize, when layout changes anyway.
export function updateBackToTopMetrics() {
  state.pageIsLong = document.documentElement.scrollHeight > window.innerHeight * 1.5;
}
export function syncBackToTop() {
  // Only reads scrollY (already known to the scroller) and the cached flag, so it
  // is safe to call on every rAF-coalesced scroll event without forcing layout.
  const visible = state.pageIsLong && window.scrollY > 700 && !state.filtersOpen;
  if (visible === state.backToTopVisible) return;
  state.backToTopVisible = visible;
  els.backToTop.hidden = !visible;
  els.backToTop.classList.toggle("is-visible", visible);
}
export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
