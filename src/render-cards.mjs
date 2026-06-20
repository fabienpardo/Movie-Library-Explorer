import { CARD_CACHE_LIMIT, DESKTOP_QUERY, VIRTUALIZE_THRESHOLD, categories } from "./config.mjs";
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
function stashCardNode(id, node) {
  if (!id) return;
  cardNodeCache.delete(id);
  cardNodeCache.set(id, node);
  while (cardNodeCache.size > CARD_CACHE_LIMIT) {
    cardNodeCache.delete(cardNodeCache.keys().next().value);
  }
}
function takeCardNode(id, row) {
  const cached = cardNodeCache.get(id);
  if (!cached) return null;
  cardNodeCache.delete(id);
  updateCardContent(cached, row);
  return cached;
}
// --- Windowed rendering (single-column / mobile only) ----------------------
// Must stay in sync with the .movie-grid gap and a rough card height in style.css.
const GRID_GAP = 13;
const VIRTUAL_OVERSCAN_PX = 1400;
const ESTIMATED_CARD_HEIGHT = 520;
const virtual = {
  active: false,
  rows: null,
  heights: [],
  estimate: ESTIMATED_CARD_HEIGHT,
  start: 0,
  end: 0,
  top: null,
  bottom: null,
  gridTop: 0,
  scrollBound: false,
  rafPending: false
};
function shouldVirtualize(count) {
  // Multi-column desktop renders in full (it performs fine and content-visibility
  // already skips off-screen work); only the tall single-column phone list windows.
  return !DESKTOP_QUERY.matches && count > VIRTUALIZE_THRESHOLD;
}
export function renderGrid(rows) {
  const grid = els.movieGrid;
  if (!rows.length) {
    stashAllCards(grid);
    teardownVirtual();
    grid.replaceChildren(createEmptyStateNode());
    return;
  }
  if (shouldVirtualize(rows.length)) renderGridWindowed(grid, rows);
  else { teardownVirtual(); renderGridFull(grid, rows); }
}
function stashAllCards(grid) {
  for (const node of Array.from(grid.children)) {
    if (node.dataset && node.dataset.movieId) stashCardNode(node.dataset.movieId, node);
  }
}
function renderGridFull(grid, rows) {
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

  const ordered = rows.map(row => {
    const id = movieId(row);
    const live = reusable.get(id);
    if (live) {
      reusable.delete(id);
      updateCardContent(live, row);
      return live;
    }
    const pooled = takeCardNode(id, row);
    if (pooled) return pooled;
    return createMovieCardNode(row);
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
function teardownVirtual() {
  if (!virtual.active && !virtual.top && !virtual.bottom) return;
  if (virtual.top) virtual.top.remove();
  if (virtual.bottom) virtual.bottom.remove();
  virtual.top = null;
  virtual.bottom = null;
  virtual.active = false;
  virtual.rows = null;
}
function makeSpacer() {
  return createElement("div", { className: "virtual-spacer", attrs: { "aria-hidden": "true" } });
}
function ensureSpacers(grid) {
  if (!virtual.top || virtual.top.parentNode !== grid) {
    virtual.top = makeSpacer();
    grid.insertBefore(virtual.top, grid.firstChild);
  }
  if (!virtual.bottom || virtual.bottom.parentNode !== grid) {
    virtual.bottom = makeSpacer();
    grid.appendChild(virtual.bottom);
  }
}
function bindVirtualScroll() {
  if (virtual.scrollBound) return;
  virtual.scrollBound = true;
  const onScroll = () => {
    if (!virtual.active || virtual.rafPending) return;
    virtual.rafPending = true;
    requestAnimationFrame(() => {
      virtual.rafPending = false;
      if (virtual.active) updateWindow(els.movieGrid, false);
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => { if (virtual.active) updateWindow(els.movieGrid, true); }, { passive: true });
}
function renderGridWindowed(grid, rows) {
  // A new result set (filter/sort/search) arrives as a fresh array — drop stale
  // height measurements so the window is rebuilt against the new content.
  if (virtual.rows !== rows) {
    virtual.rows = rows;
    virtual.heights = new Array(rows.length);
    virtual.start = 0;
    virtual.end = 0;
  }
  virtual.active = true;
  ensureSpacers(grid);
  bindVirtualScroll();
  updateWindow(grid, true);
}
function strideAt(index) {
  return (virtual.heights[index] || virtual.estimate) + GRID_GAP;
}
function updateWindow(grid, force) {
  if (!virtual.active) return;
  const rows = virtual.rows;
  const n = rows.length;

  // The grid's absolute top is stable during scroll, so only re-measure it on the
  // forced (render/resize) calls — scroll ticks reuse the cache and never read layout.
  if (force) virtual.gridTop = grid.getBoundingClientRect().top + window.scrollY;
  const gridTopAbs = virtual.gridTop;
  const relTop = window.scrollY - gridTopAbs - VIRTUAL_OVERSCAN_PX;
  const relBottom = window.scrollY + window.innerHeight - gridTopAbs + VIRTUAL_OVERSCAN_PX;

  let cum = 0;
  let start = 0;
  while (start < n && cum + strideAt(start) <= relTop) { cum += strideAt(start); start += 1; }
  let end = start;
  while (end < n && cum < relBottom) { cum += strideAt(end); end += 1; }

  if (!force && start === virtual.start && end === virtual.end) return;
  virtual.start = start;
  virtual.end = end;

  reconcileWindow(grid, rows, start, end);
  measureWindow(start, end);

  let top = 0;
  for (let i = 0; i < start; i += 1) top += strideAt(i);
  let bottom = 0;
  for (let i = end; i < n; i += 1) bottom += strideAt(i);
  // The grid inserts a gap between a spacer and its neighbouring card, so trim one
  // gap from each non-empty spacer to keep the window aligned with the scroll offset.
  virtual.top.style.height = `${Math.max(0, top - (start > 0 ? GRID_GAP : 0))}px`;
  virtual.bottom.style.height = `${Math.max(0, bottom - (end < n ? GRID_GAP : 0))}px`;
}
function reconcileWindow(grid, rows, start, end) {
  const live = new Map();
  let node = virtual.top.nextSibling;
  while (node && node !== virtual.bottom) {
    const next = node.nextSibling;
    const id = node.dataset && node.dataset.movieId;
    if (id) live.set(id, node);
    node = next;
  }

  const wanted = [];
  for (let i = start; i < end; i += 1) {
    const row = rows[i];
    const id = movieId(row);
    let el = live.get(id);
    if (el) {
      live.delete(id);
      updateCardContent(el, row);
    } else {
      el = takeCardNode(id, row) || createMovieCardNode(row);
    }
    wanted.push(el);
  }
  // Cards that scrolled out of the window: pool them (posters survive) and detach.
  for (const [id, el] of live) {
    stashCardNode(id, el);
    el.remove();
  }
  // Place the window in order directly after the top spacer.
  let ref = virtual.top.nextSibling;
  for (const el of wanted) {
    if (el === ref) { ref = ref.nextSibling; continue; }
    grid.insertBefore(el, ref);
  }
}
function measureWindow(start, end) {
  let measured = 0;
  let count = 0;
  let node = virtual.top.nextSibling;
  let i = start;
  while (node && node !== virtual.bottom && i < end) {
    if (node.dataset && node.dataset.movieId) {
      const h = node.offsetHeight;
      if (h > 0) { virtual.heights[i] = h; measured += h; count += 1; }
      i += 1;
    }
    node = node.nextSibling;
  }
  if (count > 0) virtual.estimate = Math.round((virtual.estimate + measured / count) / 2);
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
  const label = selected ? "Retirer de la sélection" : "Ajouter à la sélection";
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const symbol = button.querySelector("span");
  if (symbol) symbol.textContent = selected ? "✓" : "+";
}
function updateCardContent(node, row) {
  const model = movieViewModel(row);
  const body = node.querySelector(".movie-card__body");
  if (body) replaceChildren(body, createMovieCardBodyNodes(model));

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
function createMoviePosterNode(model, modifierClass = "") {
  if (!model.posterUrl) return null;
  const url = model.posterUrl;
  const initials = posterInitials(model.title);
  const className = ["movie-poster", modifierClass, failedPosters.has(url) ? "movie-poster--fallback" : "", loadedPosters.has(url) && !failedPosters.has(url) ? "is-loaded" : ""].filter(Boolean).join(" ");
  const figure = createElement("figure", { className, dataset: { posterInitials: initials, posterUrl: url } });
  if (failedPosters.has(url)) {
    figure.append(createElement("span", { text: initials, attrs: { "aria-hidden": "true" } }));
    return figure;
  }
  figure.append(createElement("img", { attrs: { src: url, alt: `Affiche de ${model.title}`, loading: "lazy", decoding: "async" } }));
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
function createSelectionButtonNode(rowOrModel) {
  const id = rowOrModel.id || movieId(rowOrModel);
  const selected = state.selection.has(id);
  const label = selected ? "Retirer de la sélection" : "Ajouter à la sélection";
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
function createCreditGroupNode(label, values, selected) {
  if (!values.length) return null;
  const category = selected === state.selected.director ? "director" : "actor";
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
    createCreditGroupNode("Réalisation", model.directors, state.selected.director),
    createCreditGroupNode("Acteurs", model.actors, state.selected.actor)
  ].filter(Boolean);
  return nodes.length ? createElement("div", { className: "card-credits credits" }, nodes) : null;
}
function createGenreChipsNode(model) {
  return createElement("div", { className: "card-genres chips" }, model.genres.map(genre => createCardFilterButtonNode("genre", genre, "genre-chip", "genre-chip--selected")));
}
function createCardBannerNode(model) {
  const children = [];
  const url = model.posterUrl;
  if (url && !failedPosters.has(url)) {
    children.push(createElement("img", { className: "card-banner__img", attrs: { src: url, alt: "", loading: "lazy", decoding: "async", "aria-hidden": "true" } }));
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
export function createMovieCardNode(row) {
  const model = movieViewModel(row);
  const card = createElement("article", {
    className: ["movie-card", "movie-card--media", model.posterUrl ? "movie-card--with-poster" : ""],
    dataset: { movieId: model.id }
  });
  const thumb = model.posterUrl
    ? createMoviePosterNode(model, "card-thumb")
    : createElement("figure", { className: "movie-poster card-thumb card-thumb--empty", attrs: { "aria-hidden": "true" } });
  card.append(
    createCardBannerNode(model),
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
