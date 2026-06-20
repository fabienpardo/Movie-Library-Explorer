import { categories, categoryKeys } from "./config.mjs";
import { els, state } from "./state.mjs";
import { encodeFilterValue, pluralize } from "./utils.mjs";
import { byId, createElement, replaceChildren, textNode } from "./dom.mjs";
import { sortLabel } from "./sorting.mjs";
import { activeCount, activeFilters, optionCounts, sagaOptionCounts } from "./matching.mjs";
import { syncDynamicFocusableFallback } from "./filter-panel.mjs";

export function syncMatchMode(category) {
  const group = byId(`${category}MatchMode`);
  if (!group) return;
  group.querySelectorAll("[data-match-value]").forEach(option => {
    const active = option.dataset.matchValue === state.matchMode[category];
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-pressed", String(active));
  });
}
export function syncControls() {
  els.searchInput.value = state.search;
  els.sortSelect.value = state.sort;
  for (const category of categoryKeys) {
    syncMatchMode(category);
    const searchId = categories[category].searchId;
    if (searchId) els[searchId].value = state.filterSearch[category] || "";
  }
}
export function updateFilterResultCount(count) {
  const el = byId("filterResultCount");
  if (!el) return;
  const total = state.rows.length;
  el.textContent = total ? `${count} ${count > 1 ? "films" : "film"} sur ${total}` : "";
}
export function renderDiagnostics() {
  const missing = ["genres", "runtime", "imdbRating", "country", "actors", "directors", "originalTitle", "position", "releaseDate"].filter(field => !state.columns[field]);
  const lines = [
    ...(missing.length ? [`Champs attendus manquants : ${missing.join(", ")}`] : []),
    ...state.warnings
  ];

  els.diagnostics.hidden = !lines.length;
  els.diagnostics.textContent = lines.length
    ? ["Avertissement de colonnes.", ...lines, `Colonnes du fichier : ${state.labels.join(", ")}`, "Mettez à jour COLUMNS dans src/config.mjs si nécessaire."].join("\n")
    : "";
}

export function renderFilterLists() {
  categoryKeys.forEach(renderFilterList);
  renderSagaList();
  updateCounts();
  syncDynamicFocusableFallback();
}
function renderSagaList() {
  const container = els.sagaList;
  if (!container) return;
  if (!state.columns.saga) {
    container.textContent = "Colonne saga non détectée";
    return;
  }
  const counts = sagaOptionCounts();
  if (!counts.length) {
    container.textContent = "Aucune saga disponible pour les filtres actuels";
    return;
  }
  const nodes = counts.map(([value, count]) => {
    const input = createElement("input", { attrs: { type: "checkbox", value } });
    input.checked = state.selected.saga.has(value);
    return createElement("label", { className: "filter-option" }, [
      input,
      createElement("span", { className: "filter-option__content" }, [
        createElement("span", { className: "filter-option__label", text: value }),
        createElement("span", { className: "filter-option__count", text: count })
      ])
    ]);
  });
  replaceChildren(container, nodes);
}
function renderFilterList(category) {
  const cfg = categories[category];
  const container = els[cfg.listId];
  const columnDetected = Boolean(state.columns[cfg.column]);
  const counts = optionCounts(category);

  if (!counts.length) {
    container.textContent = columnDetected ? cfg.empty : `Colonne ${cfg.label.toLowerCase()} non détectée`;
    return;
  }

  const limit = category === "genre" ? Infinity : (state.filterSearch[category] ? 180 : 80);
  const visible = counts.slice(0, limit);
  const hidden = counts.length - visible.length;
  const nodes = visible.map(([value, count]) => {
    const input = createElement("input", { attrs: { type: "checkbox", value } });
    input.checked = state.selected[category].has(value);
    return createElement("label", { className: "filter-option" }, [
      input,
      createElement("span", { className: "filter-option__content" }, [
        createElement("span", { className: "filter-option__label", text: value }),
        createElement("span", { className: "filter-option__count", text: count })
      ])
    ]);
  });
  if (hidden) nodes.push(createElement("p", { className: "hint", text: `+${hidden} autres. Recherchez pour réduire la liste.` }));
  replaceChildren(container, nodes);
}

export function renderResultSummary(rows) {
  if (!els.resultSummary) return;
  if (!state.rows.length) {
    els.resultSummary.hidden = true;
    els.resultSummary.textContent = "";
    return;
  }

  const filters = activeCount();
  const selection = state.selection.size;
  els.resultSummary.hidden = false;
  replaceChildren(els.resultSummary, [
    createElement("span", {}, [createElement("strong", { text: rows.length }), textNode(` / ${state.rows.length} films affichés`)]),
    createElement("span", { text: `Tri : ${sortLabel()}` }),
    createElement("span", { text: pluralize(filters, "filtre actif", "filtres actifs") }),
    createElement("span", { text: pluralize(selection, "film sélectionné", "films sélectionnés") })
  ]);
}

export function renderActiveFilters() {
  replaceChildren(els.activeFilters, activeFilters().map(item => createElement("span", { className: "active-filter-chip" }, [
    createElement("span", { text: `${item.group}: ${item.value}` }),
    createElement("button", {
      className: "filter-remove",
      text: "×",
      attrs: { type: "button", "aria-label": `Retirer le filtre ${item.group}` },
      dataset: { filterCategory: item.category, filterValue: encodeFilterValue(item.value) }
    })
  ])));
}
export function updateCounts() {
  const total = activeCount();
  els.filterCount.textContent = String(total);
  els.filterCount.hidden = total === 0;
  categoryKeys.forEach(category => {
    const count = state.selected[category].size;
    const badge = els[categories[category].countId];
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
  if (els.sagaSelectedCount) {
    const sagaCount = state.selected.saga.size;
    els.sagaSelectedCount.textContent = String(sagaCount);
    els.sagaSelectedCount.hidden = sagaCount === 0;
  }
}
