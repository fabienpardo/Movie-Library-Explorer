import { CARD_CACHE_LIMIT, categories } from "./config.mjs";
import { cardNodeCache, els, failedPosters, loadedPosters, state } from "./state.mjs";
import {
  decodeFilterValue,
  encodeFilterValue,
  formatRuntime,
  mainCountry,
  parseNumber,
  parseRuntime
} from "./utils.mjs";
import {
  cell,
  displayOriginalTitle,
  displayTitle,
  listFor,
  movieId,
  movieUrl,
  posterUrl,
  sagaName,
  sagaOrder,
  sagaTotal
} from "./data.mjs";
import { createElement, joinWithSeparator, replaceChildren, textNode } from "./dom.mjs";
import { activeCount } from "./matching.mjs";

const EAGER_POSTER_COUNT = 8;
const HIGH_PRIORITY_POSTER_COUNT = 3;

export function posterPriorityForIndex(index) {
  const visibleIndex = Number.isFinite(index) ? index : Number.POSITIVE_INFINITY;
  return {
    loading: visibleIndex < EAGER_POSTER_COUNT ? "eager" : "lazy",
    fetchpriority: visibleIndex < HIGH_PRIORITY_POSTER_COUNT ? "high" : "low"
  };
}

function posterImageAttrs(src, alt, priority, extraAttrs = {}) {
  return { src, alt, loading: priority.loading, decoding: "async", fetchpriority: priority.fetchpriority, ...extraAttrs };
}

function syncPosterPriority(node, priority) {
  node.querySelectorAll(".movie-poster img, .card-banner__img").forEach(image => {
    image.setAttribute("loading", priority.loading);
    image.setAttribute("fetchpriority", priority.fetchpriority);
  });
}

function filterToggleLabel(category, value) {
  const label = category === "saga" ? "saga" : categories[category].label.toLowerCase();
  const action = state.selected[category].has(value) ? "Retirer" : "Ajouter";
  return `${action} le filtre ${label} ${value}`;
}

export function createEmptyStateNode() {
  const children = [createElement("p", { text: "Aucun film ne correspond aux filtres actuels." })];
  if (activeCount() > 0) {
    children.push(createElement("button", { className: "secondary-button", text: "Tout effacer", attrs: { type: "button", "data-empty-clear": "" } }));
  }
  return createElement("div", { className: "empty" }, children);
}
// Keyed reconciliation: reuse existing card nodes (and their already-loaded poster
// images) for movies still present, refreshing only the body and the order. This
// keeps posters from reloading when filters, search, or sort change the result set.
// Drop the image sources of a card that is leaving the pool for good, so the browser
// can release its decoded poster memory promptly instead of holding it until GC.
// removeAttribute (not src="") avoids re-requesting the document URL.
function releaseCardImages(node) {
  node?.querySelectorAll("img").forEach(img => img.removeAttribute("src"));
}
function stashCardNode(id, node) {
  if (!id) return;
  cardNodeCache.delete(id);
  cardNodeCache.set(id, node);
  while (cardNodeCache.size > CARD_CACHE_LIMIT) {
    const oldestId = cardNodeCache.keys().next().value;
    releaseCardImages(cardNodeCache.get(oldestId));
    cardNodeCache.delete(oldestId);
  }
}
function takeCardNode(id, row, index) {
  const cached = cardNodeCache.get(id);
  if (!cached) return null;
  cardNodeCache.delete(id);
  updateCardContent(cached, row, index);
  return cached;
}
export function renderGrid(rows) {
  const grid = els.movieGrid;
  if (!rows.length) {
    for (const node of Array.from(grid.children)) {
      if (node.dataset && node.dataset.movieId) stashCardNode(node.dataset.movieId, node);
    }
    grid.replaceChildren(createEmptyStateNode());
    return;
  }

  const reusable = new Map();
  for (const node of Array.from(grid.children)) {
    const id = node.dataset && node.dataset.movieId;
    if (id) {
      reusable.set(id, node);
      cardNodeCache.delete(id);
    } else {
      node.remove();
    }
  }

  const ordered = rows.map((row, index) => {
    const id = movieId(row);
    const live = reusable.get(id);
    if (live) {
      reusable.delete(id);
      updateCardContent(live, row, index);
      return live;
    }
    const pooled = takeCardNode(id, row, index);
    if (pooled) return pooled;
    return createMovieCardNode(row, { index });
  });

  // Cards no longer in the result set: keep their nodes (and painted posters) in
  // the pool so they can return without a reload, then detach from the DOM.
  for (const [id, node] of reusable) {
    stashCardNode(id, node);
    node.remove();
  }

  // Place nodes in the desired order, moving reused ones as needed.
  let ref = grid.firstChild;
  for (const node of ordered) {
    if (node === ref) ref = ref.nextSibling;
    else grid.insertBefore(node, ref);
  }
  while (ref) {
    const next = ref.nextSibling;
    if (ref.dataset && ref.dataset.movieId) stashCardNode(ref.dataset.movieId, ref);
    ref.remove();
    ref = next;
  }
}
function syncCardButtonState(button, selected) {
  if (!button) return;
  const category = button.dataset.cardFilterCategory;
  const value = decodeFilterValue(button.dataset.cardFilterValue);
  button.classList.toggle("franchise-badge--selected", category === "saga" && selected);
  if (category === "genre") button.classList.toggle("genre-chip--selected", selected);
  if (category === "actor" || category === "director") button.classList.toggle("selected-credit", selected);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", filterToggleLabel(category, value));
}
function syncCardSelectionButton(node) {
  // A reused/cached card can re-enter the grid after its selection changed while it
  // was detached (e.g. removed via the selection panel). syncSelectionUI only touches
  // live DOM, so refresh the toggle here to keep cached nodes in sync.
  const button = node.querySelector("button[data-selection-id]");
  if (!button) return;
  const selected = state.selection.has(button.dataset.selectionId);
  const title = node.querySelector("h2")?.textContent?.trim() || "";
  const label = selectionToggleLabel(selected, title);
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const symbol = button.querySelector("span");
  if (symbol) symbol.textContent = selected ? "✓" : "+";
}
// Everything the card *body* renders that can change between renders: the poster
// priority bucket (from list position) and the selected-state of the genre chips and
// credit tokens it contains. The meta row is immutable per row, and the banner's saga
// badge + selection toggle are synced separately below, so they're excluded. When this
// signature is unchanged (e.g. Load More appends without touching prior cards, or a
// filter toggle that doesn't involve this card's tokens) the body rebuild is skipped.
function cardBodySignature(model, index) {
  const sel = state.selected;
  const priority = index < HIGH_PRIORITY_POSTER_COUNT ? "H" : index < EAGER_POSTER_COUNT ? "E" : "L";
  return [
    priority,
    model.genres.map(value => (sel.genre.has(value) ? "1" : "0")).join(""),
    model.actors.map(value => (sel.actor.has(value) ? "1" : "0")).join(""),
    model.directors.map(value => (sel.director.has(value) ? "1" : "0")).join("")
  ].join("|");
}
function updateCardContent(node, row, index) {
  const model = movieViewModel(row);
  const signature = cardBodySignature(model, index);
  if (node.__cardBodySignature !== signature) {
    node.__cardBodySignature = signature;
    const body = node.querySelector(".movie-card__body");
    if (body) replaceChildren(body, createMovieCardBodyNodes(model));
    syncPosterPriority(node, posterPriorityForIndex(index));
  }

  // Banner controls are cheap in-place updates and are kept in sync unconditionally:
  // the selection toggle in particular can change while a card is detached (via the
  // selection panel), which the body signature deliberately doesn't track.
  const badge = node.querySelector('.franchise-badge[data-card-filter-category="saga"]');
  if (badge) syncCardButtonState(badge, (state.selected.saga || new Set()).has(model.saga));
  syncCardSelectionButton(node);
}
export function movieViewModel(row) {
  const title = displayTitle(row);
  return {
    id: movieId(row),
    title,
    originalTitle: displayOriginalTitle(row),
    url: movieUrl(row),
    posterUrl: posterUrl(row),
    rating: cell(row, "imdbRating"),
    runtime: parseRuntime(cell(row, "runtime")),
    year: cell(row, "year"),
    country: mainCountry(cell(row, "country")),
    genres: listFor(row, "genre"),
    actors: listFor(row, "actor"),
    directors: listFor(row, "director"),
    saga: sagaName(row),
    sagaOrder: sagaOrder(row),
    sagaTotal: sagaTotal(row)
  };
}
function posterInitials(title) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0] || "";
  const last = words.length > 1 ? words[words.length - 1][0] || "" : "";
  return (first + last).toUpperCase() || "?";
}
function createMoviePosterNode(model, modifierClass = "", priority = posterPriorityForIndex()) {
  if (!model.posterUrl) return null;
  const url = model.posterUrl;
  const initials = posterInitials(model.title);
  const className = ["movie-poster", modifierClass, failedPosters.has(url) ? "movie-poster--fallback" : "", loadedPosters.has(url) && !failedPosters.has(url) ? "is-loaded" : ""].filter(Boolean).join(" ");
  const figure = createElement("figure", { className, dataset: { posterInitials: initials, posterUrl: url } });
  if (failedPosters.has(url)) {
    figure.append(createElement("span", { text: initials, attrs: { "aria-hidden": "true" } }));
    return figure;
  }
  figure.append(createElement("img", { attrs: posterImageAttrs(url, `Affiche de ${model.title}`, priority) }));
  return figure;
}
function createMovieTitleNodes(model) {
  const h2 = createElement("h2");
  if (model.url) {
    h2.append(createElement("a", {
      className: "movie-title-link",
      text: model.title,
      attrs: { href: model.url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Ouvrir ${model.title} sur IMDb` }
    }));
  } else {
    h2.textContent = model.title;
  }
  return [h2, model.originalTitle ? createElement("p", { className: "original-title", text: model.originalTitle }) : null].filter(Boolean);
}
export function selectionToggleLabel(selected, title) {
  const base = selected ? "Retirer de la sélection" : "Ajouter à la sélection";
  return title ? `${base} : ${title}` : base;
}
function createSelectionButtonNode(rowOrModel) {
  const id = rowOrModel.id || movieId(rowOrModel);
  const title = rowOrModel.title || displayTitle(rowOrModel);
  const selected = state.selection.has(id);
  const label = selectionToggleLabel(selected, title);
  const button = createElement("button", {
    className: ["selection-toggle", selected ? "is-selected" : ""],
    attrs: { type: "button", "aria-label": label, title: label },
    dataset: { selectionId: id }
  }, [createElement("span", { text: selected ? "✓" : "+", attrs: { "aria-hidden": "true" } })]);
  button.setAttribute("aria-pressed", String(selected));
  return button;
}
function createFranchiseBadgeNode(model) {
  if (!model.saga) return null;
  const order = Number.isFinite(model.sagaOrder) ? model.sagaOrder : null;
  const total = model.sagaTotal > 0 ? model.sagaTotal : null;
  const suffix = order && total ? ` · ${order} / ${total}` : order ? ` · ${order}` : "";
  const selected = (state.selected.saga || new Set()).has(model.saga);
  const button = createElement("button", {
    className: ["franchise-badge", "card-filter-button", selected ? "franchise-badge--selected" : ""],
    text: `${model.saga}${suffix}`,
    attrs: { type: "button", "aria-label": filterToggleLabel("saga", model.saga) },
    dataset: { cardFilterCategory: "saga", cardFilterValue: encodeFilterValue(model.saga) }
  });
  button.setAttribute("aria-pressed", String(selected));
  return button;
}
function createImdbBadgeNode(model) {
  if (!model.rating) return null;
  return createElement("span", { className: ["imdb-badge", ratingClass(model.rating)] }, [
    createElement("span", { className: "imdb-dot", attrs: { "aria-hidden": "true" } }),
    createElement("span", { className: "imdb-badge__value", text: `IMDb ${model.rating}` })
  ]);
}
function createMetaSeparatorNode() {
  return createElement("span", { className: "meta-sep", text: "·", attrs: { "aria-hidden": "true" } });
}
function createCardMetaNode(model) {
  const items = [
    createImdbBadgeNode(model),
    model.year ? createElement("span", { className: "meta-item meta-item--year", text: model.year }) : null,
    createElement("span", { className: "meta-item", text: formatRuntime(model.runtime) }),
    model.country ? createElement("span", { className: "meta-item", text: model.country }) : null
  ];
  return createElement("div", { className: "meta-row" }, joinWithSeparator(items, createMetaSeparatorNode));
}
function createCardFilterButtonNode(category, value, baseClass, selectedClass) {
  const selected = state.selected[category].has(value);
  const button = createElement("button", {
    className: [baseClass, "card-filter-button", selected ? selectedClass : ""],
    text: value,
    attrs: { type: "button", "aria-label": filterToggleLabel(category, value) },
    dataset: { cardFilterCategory: category, cardFilterValue: encodeFilterValue(value) }
  });
  button.setAttribute("aria-pressed", String(selected));
  return button;
}
function createCreditGroupNode(label, values, category) {
  if (!values.length) return null;
  const valueNodes = [];
  values.forEach((value, index) => {
    const children = [createCardFilterButtonNode(category, value, "credit-token", "selected-credit")];
    if (index < values.length - 1) children.push(createElement("span", { className: "credit-separator", text: "," }));
    valueNodes.push(createElement("span", { className: "credit-item" }, children));
    if (index < values.length - 1) valueNodes.push(textNode(" "));
  });
  return createElement("div", { className: "credit-group" }, [
    createElement("div", { className: "credit-label", text: label }),
    createElement("div", { className: "credit-value" }, valueNodes)
  ]);
}
function createCardCreditsNode(model) {
  const nodes = [
    createCreditGroupNode("Réalisation", model.directors, "director"),
    createCreditGroupNode("Acteurs", model.actors, "actor")
  ].filter(Boolean);
  return nodes.length ? createElement("div", { className: "card-credits credits" }, nodes) : null;
}
function createGenreChipsNode(model) {
  return createElement("div", { className: "card-genres chips" }, model.genres.map(genre => createCardFilterButtonNode("genre", genre, "genre-chip", "genre-chip--selected")));
}
function createCardBannerNode(model, priority) {
  const children = [];
  const url = model.posterUrl;
  if (url && !failedPosters.has(url)) {
    children.push(createElement("img", { className: "card-banner__img", attrs: posterImageAttrs(url, "", priority, { "aria-hidden": "true" }) }));
  }
  children.push(createElement("div", { className: "card-banner__scrim", attrs: { "aria-hidden": "true" } }));
  children.push(createFranchiseBadgeNode(model));
  children.push(createSelectionButtonNode(model));
  return createElement("div", { className: "card-banner" }, children);
}
function createMovieCardBodyNodes(model) {
  return [
    createCardMetaNode(model),
    createElement("div", { className: "card-divider", attrs: { "aria-hidden": "true" } }),
    createCardCreditsNode(model),
    createGenreChipsNode(model)
  ].filter(Boolean);
}
export function createMovieCardNode(row, options = {}) {
  const model = movieViewModel(row);
  const priority = posterPriorityForIndex(options.index);
  const card = createElement("article", {
    className: ["movie-card", "movie-card--media", model.posterUrl ? "movie-card--with-poster" : ""],
    dataset: { movieId: model.id }
  });
  // Seed the body signature so the next render can skip rebuilding an unchanged body.
  card.__cardBodySignature = cardBodySignature(model, options.index);
  const thumb = model.posterUrl
    ? createMoviePosterNode(model, "card-thumb", priority)
    : createElement("figure", { className: "movie-poster card-thumb card-thumb--empty", attrs: { "aria-hidden": "true" } });
  card.append(
    createCardBannerNode(model, priority),
    createElement("div", { className: "card-seam" }, [
      thumb,
      createElement("div", { className: "card-title-block movie-card__title-block" }, createMovieTitleNodes(model))
    ]),
    createElement("div", { className: "movie-card__body" }, createMovieCardBodyNodes(model))
  );
  return card;
}
export function ratingClass(value) {
  const score = parseNumber(value);
  if (!Number.isFinite(score)) return "meta-badge--rating-unknown";
  return score >= 8 ? "meta-badge--rating-good" : score >= 7 ? "meta-badge--rating-mid" : "meta-badge--rating-low";
}
export function handlePosterError(event) {
  // The decorative banner image is not inside a .movie-poster figure: drop it so
  // the gradient backdrop shows, and remember the failure for re-created cards.
  const banner = event.target.closest?.(".card-banner__img");
  if (banner) {
    const url = banner.getAttribute("src");
    if (url) failedPosters.add(url);
    banner.remove();
    return;
  }

  const image = event.target.closest?.(".movie-poster img");
  if (!image) return;
  const figure = image.closest(".movie-poster");
  if (!figure) return;
  if (figure.dataset.posterUrl) failedPosters.add(figure.dataset.posterUrl);
  const initials = figure.getAttribute("data-poster-initials") || "?";
  figure.classList.add("movie-poster--fallback");
  replaceChildren(figure, [createElement("span", { text: initials, attrs: { "aria-hidden": "true" } })]);
}
export function handlePosterLoad(event) {
  const image = event.target.closest?.(".movie-poster img");
  if (!image) return;
  const figure = image.closest(".movie-poster");
  if (!figure) return;
  if (figure.dataset.posterUrl) loadedPosters.add(figure.dataset.posterUrl);
  figure.classList.add("is-loaded");
}
