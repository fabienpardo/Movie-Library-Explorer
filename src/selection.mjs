import { els, persistSelection, state } from "./state.mjs";
import { formatRuntime, mainCountry, parseRuntime, pluralize, toSafeDomId } from "./utils.mjs";
import { cell, displayTitle, movieId } from "./data.mjs";
import { createElement, replaceChildren } from "./dom.mjs";
import { filteredRows } from "./matching.mjs";
import { createMovieCardNode } from "./render-cards.mjs";
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
    const label = selected ? "Retirer de la sélection" : "Ajouter à la sélection";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    const symbol = button.querySelector("span");
    if (symbol) symbol.textContent = selected ? "✓" : "+";
  });
  syncSelectionCount();
  renderResultSummary(filteredRows());
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
export function toggleSelectionPanel() {
  state.selectionPanelOpen = !state.selectionPanelOpen;
  renderSelectionPanel();
  syncSelectionCount();
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
  return [item, createElement("div", { className: "selection-detail", attrs: { id: detailId } }, [createMovieCardNode(row)])];
}
export function renderSelectionPanel() {
  if (!els.selectionPanel) return;
  els.selectionPanel.hidden = !state.selectionPanelOpen;
  if (!state.selectionPanelOpen) return;

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
  const children = [
    createElement("div", { className: "selection-panel__header" }, [
      createElement("div", {}, [
        createElement("p", { className: "eyebrow", text: "Exploration" }),
        createElement("h2", { text: "Sélection temporaire", attrs: { id: "selectionPanelHeading" } }),
        createElement("p", { text: pluralize(state.selection.size, "film sélectionné", "films sélectionnés") })
      ]),
      clearButton
    ])
  ];
  if (rows.length) {
    children.push(createElement("div", { className: "selection-list" }, rows.flatMap(createSelectionItemNodes)));
  } else {
    children.push(createElement("p", { className: "selection-empty", text: "Aucun film sélectionné." }));
  }
  replaceChildren(els.selectionPanel, children);
}
