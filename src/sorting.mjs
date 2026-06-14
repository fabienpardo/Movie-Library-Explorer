import { els, state } from "./state.mjs";
import { cell, displayTitle } from "./data.mjs";
import { mainCountry, parseDateValue, parseNumber, parseRuntime } from "./utils.mjs";

export function sortRows(rows) {
  const [field, direction] = state.sort.split("-");
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compare(sortValue(a, field), sortValue(b, field), sign));
}
export function sortableTitle(value) {
  // Same normalization is used for title and original-title sorting: leading articles and edge punctuation do not affect rank.
  return normalizeSortText(stripLeadingArticle(stripSortEdgePunctuation(String(value || ""))));
}
export function stripSortEdgePunctuation(value) {
  return value.trim().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
}
export function stripLeadingArticle(value) {
  return value
    .replace(/^(?:l[’']|le|la|les|un|une|des|the|a|an)\s+/i, "")
    .replace(/^(?:l[’'])/i, "")
    .trim();
}
export function normalizeSortText(value) {
  return value
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function sortValue(row, field) {
  if (field === "runtime") return parseRuntime(cell(row, "runtime"));
  if (field === "position") return parseNumber(cell(row, "position"));
  if (field === "year") {
    const releaseDate = parseDateValue(cell(row, "releaseDate"));
    if (Number.isFinite(releaseDate)) return releaseDate;

    const year = parseNumber(cell(row, "year"));
    return Number.isFinite(year) ? Date.UTC(year, 0, 1) : Number.NaN;
  }
  if (field === "imdbRating") return parseNumber(cell(row, field));
  if (field === "originalTitle") return sortableTitle(cell(row, "originalTitle") || displayTitle(row));
  if (field === "country") return mainCountry(cell(row, "country"));
  return sortableTitle(displayTitle(row));
}
export function compare(a, b, sign) {
  const numberSort = typeof a === "number" || typeof b === "number";
  if (numberSort) {
    const validA = Number.isFinite(a);
    const validB = Number.isFinite(b);
    if (!validA && !validB) return 0;
    if (!validA) return 1;
    if (!validB) return -1;
    return (a - b) * sign;
  }

  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * sign;
}

export function sortLabel() {
  const option = els.sortSelect?.selectedOptions?.[0];
  return option ? option.textContent.trim() : state.sort;
}
