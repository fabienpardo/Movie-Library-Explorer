import { FOCUSABLE, PANEL_FOCUSABLE, SUPPORTS_INERT } from "./config.mjs";
import { els, persistSelection, state } from "./state.mjs";
import { formatRuntime, mainCountry, parseRuntime, pluralize, toSafeDomId } from "./utils.mjs";
import { cell, displayTitle, movieId } from "./data.mjs";
import { createElement, replaceChildren } from "./dom.mjs";
import { filteredRows } from "./matching.mjs";
import { createMovieCardNode, selectionToggleLabel } from "./render-cards.mjs";
import { renderResultSummary } from "./render-filters.mjs";

export function selectedRows() {
  const selectedIds = state.selection;
  return state.rows.filter(row => selectedIds.has(movieId(row)));
}
export function syncSelectionCount() {
  els.selectionCount.textContent = String(state.selection.size);
  els.selectionCount.hidden = state.selection.size === 0;
  els.toggleSelectionPanel.setAttribute("aria-expanded", String(state.selectionPanelOpen));
}
export function toggleMovieSelectionById(id) {
  if (!id) return;
  if (state.selection.has(id)) {
    state.selection.delete(id);
    if (state.selectionDetailId === id) state.selectionDetailId = "";
  } else {
    state.selection.add(id);
  }
  persistSelection();
  syncSelectionUI();
}
// Removing an item from the still-open selection dialog rebuilds the list, which
// drops focus onto <body>. Move it to the next item's remove button (or the previous
// one, or a safe dialog control) so keyboard/screen-reader users keep their place.
export function removeSelectionItem(id) {
  if (!id) return;
  const index = selectedRows().findIndex(row => movieId(row) === id);
  toggleMovieSelectionById(id);
  if (!state.selectionPanelOpen) return;
  const removeButtons = [...els.selectionPanel.querySelectorAll("button[data-selection-remove-id]")];
  const fallback = els.selectionPanel.querySelector("[data-selection-action='clear']:not([disabled]), [data-selection-action='close']");
  const target = removeButtons[index] || removeButtons[index - 1] || fallback || els.selectionPanel;
  target.focus?.();
}
export function clearSelection() {
  state.selection.clear();
  state.selectionDetailId = "";
  persistSelection();
  syncSelectionUI();
}
// Selection does not change which movies are shown or their order, so update the
// selection controls in place instead of rebuilding the grid (which would reload posters).
function syncSelectionUI() {
  document.querySelectorAll("button[data-selection-id]").forEach(button => {
    const selected = state.selection.has(button.dataset.selectionId);
    const title = button.closest(".movie-card")?.querySelector("h2")?.textContent?.trim() || "";
    const label = selectionToggleLabel(selected, title);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    const symbol = button.querySelector("span");
    if (symbol) symbol.textContent = selected ? "✓" : "+";
  });
  syncSelectionCount();
  const rows = filteredRows();
  renderResultSummary(rows.slice(0, state.visibleMovieLimit), rows.length);
  renderSelectionPanel();
}
export function toggleSelectionDetail(id) {
  if (!id) return;
  state.selectionDetailId = state.selectionDetailId === id ? "" : id;
  renderSelectionPanel();
  // renderSelectionPanel rebuilds the panel's markup, so return focus to the summary the user just activated.
  const selector = typeof CSS !== "undefined" && CSS.escape ? `button[data-selection-detail-id="${CSS.escape(id)}"]` : null;
  if (selector) els.selectionPanel?.querySelector(selector)?.focus();
}
// The selection drawer is modal on every breakpoint, so the whole app behind it
// (header, main content incl. the filter sidebar, back-to-top) must be inert while
// it is open. These regions are never inerted by other logic, so toggling them from
// the open state is safe.
function selectionBackgroundRegions() {
  return [document.querySelector(".app-header"), document.querySelector(".app-shell"), els.backToTop];
}
function syncSelectionA11y() {
  const open = state.selectionPanelOpen;
  els.selectionPanel.setAttribute("aria-hidden", String(!open));
  els.selectionPanel.toggleAttribute("inert", !open);
  selectionBackgroundRegions().forEach(region => region?.toggleAttribute("inert", open));
  syncSelectionFocusableFallback(!open);
  if (open) {
    els.selectionPanel.setAttribute("role", "dialog");
    els.selectionPanel.setAttribute("aria-modal", "true");
  } else {
    els.selectionPanel.removeAttribute("role");
    els.selectionPanel.removeAttribute("aria-modal");
  }
}
function syncSelectionFocusableFallback(disabled) {
  if (SUPPORTS_INERT) return;
  els.selectionPanel.querySelectorAll(PANEL_FOCUSABLE).forEach(control => {
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
function focusableSelectionControls() {
  return [...els.selectionPanel.querySelectorAll(FOCUSABLE)].filter(control => !control.closest("[hidden]") && control.getClientRects().length);
}
export function trapSelectionFocus(event) {
  if (event.key !== "Tab" || !state.selectionPanelOpen) return;
  const focusable = focusableSelectionControls();
  const first = focusable[0] || els.selectionPanel;
  const last = focusable[focusable.length - 1] || els.selectionPanel;

  if (!els.selectionPanel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
export function openSelectionPanel() {
  state.selectionPanelOpen = true;
  state.lastSelectionFocus = document.activeElement;
  renderSelectionPanel();
  els.selectionPanel.classList.add("is-open");
  els.selectionBackdrop.hidden = false;
  document.body.classList.add("selection-open");
  syncSelectionA11y();
  syncSelectionCount();
  // Focus synchronously (the drawer is already in layout): a deferred focus could
  // otherwise land after a quick follow-up interaction and steal focus from it.
  const closeButton = els.selectionPanel.querySelector("[data-selection-action='close']");
  (closeButton || els.selectionPanel).focus();
}
export function closeSelectionPanel() {
  state.selectionPanelOpen = false;
  els.selectionPanel.classList.remove("is-open");
  els.selectionBackdrop.hidden = true;
  document.body.classList.remove("selection-open");
  syncSelectionA11y();
  syncSelectionCount();
  if (state.lastSelectionFocus?.focus) state.lastSelectionFocus.focus();
  state.lastSelectionFocus = null;
}
export function toggleSelectionPanel() {
  if (state.selectionPanelOpen) closeSelectionPanel();
  else openSelectionPanel();
}
function createSelectionItemNodes(row) {
  const id = movieId(row);
  const expanded = state.selectionDetailId === id;
  const detailId = toSafeDomId(id, "selection-detail");
  const title = displayTitle(row);
  const meta = [cell(row, "year"), mainCountry(cell(row, "country")), formatRuntime(parseRuntime(cell(row, "runtime")))].filter(Boolean).join(" · ");
  const item = createElement("article", { className: ["selection-item", expanded ? "is-expanded" : ""] }, [
    createElement("button", {
      className: "selection-item__summary",
      attrs: { type: "button", "aria-expanded": String(expanded), "aria-controls": detailId },
      dataset: { selectionDetailId: id }
    }, [
      createElement("span", { className: "selection-item__text" }, [
        createElement("span", { className: "selection-item__title", text: title }),
        createElement("span", { className: "selection-item__meta", text: meta })
      ]),
      createElement("span", { className: "selection-item__hint", text: expanded ? "Masquer" : "Détails" })
    ]),
    createElement("button", {
      className: "filter-remove",
      text: "×",
      attrs: { type: "button", "aria-label": `Retirer ${title} de la sélection` },
      dataset: { selectionRemoveId: id }
    })
  ]);
  if (!expanded) return [item];
  // Expanded selection details are opened on demand, so treat their poster like visible first-screen media.
  return [item, createElement("div", { className: "selection-detail", attrs: { id: detailId } }, [createMovieCardNode(row, { index: 0 })])];
}
export function renderSelectionPanel() {
  if (!els.selectionPanel) return;

  const rows = selectedRows();
  // Detail expansion is tied to selected rows, not the filtered result grid, so users can keep reviewing a shortlist while exploring other filters.
  const detailIsValid = rows.some(row => movieId(row) === state.selectionDetailId);
  if (!detailIsValid) state.selectionDetailId = "";

  const clearButton = createElement("button", {
    className: "secondary-button selection-clear-button",
    text: "Vider",
    attrs: { type: "button", "data-selection-action": "clear" },
    disabled: !state.selection.size
  });
  const closeButton = createElement("button", {
    className: "icon-button selection-close-button",
    text: "×",
    attrs: { type: "button", "aria-label": "Fermer la sélection", "data-selection-action": "close" }
  });
  const children = [
    createElement("div", { className: "selection-panel__header" }, [
      createElement("div", {}, [
        createElement("p", { className: "eyebrow", text: "Exploration" }),
        createElement("h2", { text: "Ma sélection", attrs: { id: "selectionPanelHeading" } }),
        createElement("p", { text: pluralize(state.selection.size, "film sélectionné", "films sélectionnés") })
      ]),
      createElement("div", { className: "selection-panel__header-actions" }, [clearButton, closeButton])
    ])
  ];
  if (rows.length) {
    children.push(createElement("div", { className: "selection-list" }, rows.flatMap(createSelectionItemNodes)));
  } else {
    children.push(createElement("p", { className: "selection-empty", text: "Aucun film sélectionné." }));
  }
  replaceChildren(els.selectionPanel, children);
  syncSelectionA11y();
}
