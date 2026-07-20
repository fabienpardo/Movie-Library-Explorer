#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createTestRegistry } = require('./helpers/test-runner');
const { runBrowserTests, runOneBrowserTest } = require('./helpers/browser-runner');
const {
  createPage,
  evaluate,
  evaluateFunction,
  waitForExpression,
  setInputValue,
  setSelectValue,
  click,
  clickFilterOptionByLabel
} = require('./browser-test-utils');

const { tests, test } = createTestRegistry();

test('loads the fixture and renders the library without browser errors', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  const snapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    totalRows: window.__MovieExplorerTestHooks.state.rows.length,
    initialLimit: window.__MovieExplorerTestHooks.INITIAL_VISIBLE_MOVIES,
    statusHidden: document.querySelector('#status').hidden,
    summary: document.querySelector('#resultSummary').textContent.replace(/\s+/g, ' ').trim(),
    diagnosticsHidden: document.querySelector('#diagnostics').hidden,
    firstCardTitle: document.querySelector('.movie-card h2')?.textContent.trim(),
    statCards: document.querySelectorAll('.summary-card').length,
    selectionButtonText: document.querySelector('.movie-card button[data-selection-id]')?.textContent.trim(),
    selectionButtonLabel: document.querySelector('.movie-card button[data-selection-id]')?.getAttribute('aria-label'),
    selectionButtonPosition: getComputedStyle(document.querySelector('.movie-card button[data-selection-id]')).position,
    cardPosition: getComputedStyle(document.querySelector('.movie-card')).position,
    firstPosterSrc: document.querySelector('.movie-card .movie-poster')?.dataset.posterUrl || document.querySelector('.movie-card .movie-poster img')?.getAttribute('src'),
    posterCount: document.querySelectorAll('.movie-card .movie-poster').length,
    hasMediaCard: Boolean(document.querySelector('.movie-card.movie-card--media')),
    hasCardWithPoster: Boolean(document.querySelector('.movie-card.movie-card--with-poster')),
    hasFranchiseBadge: document.querySelectorAll('.franchise-badge').length,
    loadMoreHidden: document.querySelector('#loadMore').hidden,
    loadMoreText: document.querySelector('#loadMore').textContent.trim()
  }));

  assert.equal(snapshot.cards, snapshot.initialLimit);
  assert.equal(snapshot.statusHidden, true);
  assert.match(snapshot.summary, new RegExp(`${snapshot.initialLimit}\\s*\\/\\s*${snapshot.totalRows} films affichés`));
  assert.equal(snapshot.statCards, 0);
  assert.equal(snapshot.diagnosticsHidden, true);
  assert.ok(snapshot.firstCardTitle);
  assert.equal(snapshot.selectionButtonText, '+');
  // The selection button name includes the movie title so repeated buttons are distinguishable.
  assert.equal(snapshot.selectionButtonLabel, `Ajouter à la sélection : ${snapshot.firstCardTitle}`);
  assert.equal(snapshot.selectionButtonPosition, 'absolute');
  assert.equal(snapshot.cardPosition, 'relative');
  assert.ok(snapshot.posterCount >= 1);
  assert.equal(snapshot.hasMediaCard, true);
  assert.equal(snapshot.hasCardWithPoster, true);
  assert.ok(snapshot.hasFranchiseBadge >= 1);
  assert.match(snapshot.firstPosterSrc, /^https:\/\//);
  assert.equal(snapshot.loadMoreHidden, false);
  assert.equal(snapshot.loadMoreText, 'Afficher plus');
});

test('movie titles open Apple TV and IMDb rating badges open IMDb', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await setInputValue(page, '#searchInput', '60 secondes chrono');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === 1`, 'movie with Apple TV and IMDb links');
  const linked = await evaluateFunction(page, () => {
    const titleLink = document.querySelector('.movie-title-link');
    const card = titleLink?.closest('.movie-card');
    const imdbLink = card?.querySelector('a.imdb-badge');
    return {
      titleHref: titleLink?.href || '',
      titleLabel: titleLink?.getAttribute('aria-label') || '',
      imdbHref: imdbLink?.href || '',
      imdbLabel: imdbLink?.getAttribute('aria-label') || ''
    };
  });
  assert.match(linked.titleHref, /^https:\/\/tv\.apple\.com\//);
  assert.match(linked.titleLabel, /dans Apple TV$/);
  assert.match(linked.imdbHref, /^https:\/\/(?:www\.)?imdb\.com\//);
  assert.match(linked.imdbLabel, /sur IMDb$/);

  await setInputValue(page, '#searchInput', 'Daft Punk Unchained');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === 1`, 'movie without an Apple TV link');
  const missingAppleLink = await evaluateFunction(page, () => {
    const card = document.querySelector('.movie-card');
    return {
      title: card?.querySelector('h2')?.textContent.trim(),
      hasTitleLink: Boolean(card?.querySelector('h2 a')),
      imdbHref: card?.querySelector('a.imdb-badge')?.href || ''
    };
  });
  assert.equal(missingAppleLink.title, 'Daft Punk Unchained');
  assert.equal(missingAppleLink.hasTitleLink, false);
  assert.equal(missingAppleLink.imdbHref, 'https://www.imdb.com/title/tt3833822/');
});

test('load more appends another batch and result changes reset to the first batch', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  const initialLimit = await evaluate(page, `window.__MovieExplorerTestHooks.INITIAL_VISIBLE_MOVIES`);
  const batchSize = await evaluate(page, `window.__MovieExplorerTestHooks.LOAD_MORE_MOVIES`);

  await click(page, '#loadMore');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === ${initialLimit + batchSize}`, 'second result batch');
  const afterLoadMore = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    summary: document.querySelector('#resultSummary').textContent.replace(/\s+/g, ' ').trim(),
    visibleLimit: window.__MovieExplorerTestHooks.state.visibleMovieLimit
  }));
  assert.equal(afterLoadMore.cards, initialLimit + batchSize);
  assert.equal(afterLoadMore.visibleLimit, initialLimit + batchSize);
  assert.match(afterLoadMore.summary, new RegExp(`${initialLimit + batchSize}\\s*\\/\\s*\\d+ films affichés`));

  await setSelectValue(page, '#sortSelect', 'title-asc');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === window.__MovieExplorerTestHooks.INITIAL_VISIBLE_MOVIES`, 'first batch after sort reset');
  const afterSort = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    visibleLimit: window.__MovieExplorerTestHooks.state.visibleMovieLimit,
    summary: document.querySelector('#resultSummary').textContent.replace(/\s+/g, ' ').trim()
  }));
  assert.equal(afterSort.cards, initialLimit);
  assert.equal(afterSort.visibleLimit, initialLimit);
  assert.match(afterSort.summary, new RegExp(`${initialLimit}\\s*\\/\\s*\\d+ films affichés`));
});

test('search reduces displayed results and clear filters restores them', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await setInputValue(page, '#searchInput', 'matrix');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length > 0 && document.querySelectorAll('.movie-card').length < window.__MovieExplorerTestHooks.state.rows.length`, 'search results');

  const searchSnapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    totalRows: window.__MovieExplorerTestHooks.state.rows.length,
    activeText: document.querySelector('#activeFilters').textContent,
    allContainQuery: [...document.querySelectorAll('.movie-card')].every(card => card.textContent.toLowerCase().includes('matrix'))
  }));
  assert.ok(searchSnapshot.cards > 0 && searchSnapshot.cards < searchSnapshot.totalRows);
  assert.match(searchSnapshot.activeText, /Recherche:\s*matrix/);
  assert.equal(searchSnapshot.allContainQuery, true);

  await click(page, '#clearFilters');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === window.__MovieExplorerTestHooks.INITIAL_VISIBLE_MOVIES`, 'first batch after clearing');
  assert.equal(await evaluate(page, `document.querySelector('#activeFilters').textContent.trim()`), '');
});

test('genre checkbox selection updates cards, count badges and selected chips', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `document.querySelector('#activeFilters').textContent.includes('Genre: Action')`, 'Action filter selection');

  const snapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    totalRows: window.__MovieExplorerTestHooks.state.rows.length,
    filterCount: document.querySelector('#filterCount').textContent.trim(),
    genreSelectedCount: document.querySelector('#genreSelectedCount').textContent.trim(),
    hasSelectedChip: Boolean(document.querySelector('.genre-chip--selected')),
    allCardsHaveAction: [...document.querySelectorAll('.movie-card')].every(card => card.textContent.includes('Action'))
  }));
  assert.ok(snapshot.cards > 0 && snapshot.cards < snapshot.totalRows);
  assert.equal(snapshot.filterCount, '1');
  assert.equal(snapshot.genreSelectedCount, '1');
  assert.equal(snapshot.hasSelectedChip, true);
  assert.equal(snapshot.allCardsHaveAction, true);
});

test('the segmented match toggle switches between "all" and "any" matching', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await clickFilterOptionByLabel(page, '#genreList', 'Comédie');
  await waitForExpression(page, `window.__MovieExplorerTestHooks.state.selected.genre.size === 2`, 'two genres selected');

  const allCount = await evaluate(page, `window.__MovieExplorerTestHooks.filteredRows().length`);

  // Switch to "Au moins un" (any) — should broaden the result set.
  await click(page, '#genreMatchMode [data-match-value="any"]');
  await waitForExpression(page, `window.__MovieExplorerTestHooks.state.matchMode.genre === 'any'`, 'match mode any');
  const snapshot = await evaluateFunction(page, () => ({
    anyActive: document.querySelector('#genreMatchMode [data-match-value="any"]').classList.contains('is-active'),
    allActive: document.querySelector('#genreMatchMode [data-match-value="all"]').classList.contains('is-active'),
    anyCount: window.__MovieExplorerTestHooks.filteredRows().length
  }));
  assert.equal(snapshot.anyActive, true);
  assert.equal(snapshot.allActive, false);
  assert.ok(snapshot.anyCount > allCount, '"any" should match at least as many films as "all"');
});

test('filter tab activation is scoped to navigation buttons only', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `document.querySelector('#activeFilters button[data-filter-category="genre"]')`, 'active genre chip remove button');

  await click(page, '.filter-jump-nav__button[data-filter-category="actor"]');
  const snapshot = await evaluateFunction(page, () => {
    const remove = document.querySelector('#activeFilters button[data-filter-category="genre"]');
    const actorTab = document.querySelector('.filter-jump-nav__button[data-filter-category="actor"]');
    return {
      removeHasActiveClass: remove.classList.contains('is-active'),
      removeAriaPressed: remove.getAttribute('aria-pressed'),
      actorTabActive: actorTab.classList.contains('is-active'),
      actorPanelHidden: document.querySelector('#actorSection').hidden
    };
  });
  assert.equal(snapshot.removeHasActiveClass, false);
  assert.equal(snapshot.removeAriaPressed, null);
  assert.equal(snapshot.actorTabActive, true);
  assert.equal(snapshot.actorPanelHidden, false);
});

test('card filter buttons toggle a filter on and off', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  const chipValue = await evaluateFunction(page, () => {
    const button = document.querySelector('button[data-card-filter-category="genre"]');
    if (!button) throw new Error('No genre card filter button found');
    button.click();
    return button.textContent.trim();
  });
  await waitForExpression(page, `window.__MovieExplorerTestHooks.activeCount() === 1`, 'chip filter to be active');
  const activeText = await evaluate(page, `document.querySelector('#activeFilters').textContent`);
  assert.ok(activeText.includes(`Genre: ${chipValue}`));

  await click(page, 'button[data-card-filter-category="genre"]');
  await waitForExpression(page, `window.__MovieExplorerTestHooks.activeCount() === 0`, 'chip filter to be removed');
  assert.equal(await evaluate(page, `document.querySelector('#activeFilters').textContent.trim()`), '');
});

test('clicking a franchise badge filters the library to that saga', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  const saga = await evaluateFunction(page, () => {
    const badge = document.querySelector('.franchise-badge[data-card-filter-category="saga"]');
    if (!badge) throw new Error('No franchise badge found');
    badge.click();
    return decodeURIComponent(badge.dataset.cardFilterValue);
  });
  await waitForExpression(page, `document.querySelector('#activeFilters').textContent.includes('Saga: ${saga}')`, 'saga filter active');

  const snapshot = await evaluateFunction(page, (sagaName) => ({
    filterCount: document.querySelector('#filterCount').textContent.trim(),
    cards: document.querySelectorAll('.movie-card--media').length,
    selectedBadges: document.querySelectorAll('.movie-card--media .franchise-badge[aria-pressed="true"]').length,
    allSameSaga: [...document.querySelectorAll('.movie-card--media .franchise-badge')]
      .every(b => b.textContent.startsWith(sagaName)),
    firstActorOption: document.querySelector('#actorList .filter-option')?.textContent.replace(/\s+/g, ' ').trim()
  }), saga);
  assert.equal(snapshot.filterCount, '1');
  assert.ok(snapshot.cards > 0);
  assert.ok(snapshot.selectedBadges > 0, 'reused franchise badges should show selected state');
  assert.equal(snapshot.allSameSaga, true);
  assert.match(snapshot.firstActorOption, /Pierre Fresnay|Raimu/);

  // Removing the active-filter chip clears the saga filter. Scope to #activeFilters
  // because the saga filter tab now also carries data-filter-category="saga".
  await click(page, '#activeFilters button[data-filter-category="saga"]');
  await waitForExpression(page, `window.__MovieExplorerTestHooks.activeCount() === 0`, 'saga filter removed');
});

test('saga filter tab lists sagas and selecting one narrows the library', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await click(page, '.filter-jump-nav__button[data-filter-category="saga"]');
  const saga = await evaluateFunction(page, () => {
    const panelVisible = !document.querySelector('[data-filter-panel="saga"]').hidden;
    if (!panelVisible) throw new Error('Saga panel did not activate');
    const option = document.querySelector('#sagaList .filter-option .filter-option__label');
    if (!option) throw new Error('No saga option rendered');
    return option.textContent.trim();
  });
  await clickFilterOptionByLabel(page, '#sagaList', saga);
  await waitForExpression(page, `document.querySelector('#activeFilters').textContent.includes('Saga: ${saga}')`, 'saga filter active from list');

  const snapshot = await evaluateFunction(page, (sagaName) => ({
    filterCount: document.querySelector('#filterCount').textContent.trim(),
    sagaSelectedCount: document.querySelector('#sagaSelectedCount').textContent.trim(),
    cards: document.querySelectorAll('.movie-card--media').length,
    totalRows: window.__MovieExplorerTestHooks.state.rows.length,
    allSameSaga: [...document.querySelectorAll('.movie-card--media .franchise-badge')].every(b => b.textContent.startsWith(sagaName))
  }), saga);
  assert.equal(snapshot.filterCount, '1');
  assert.equal(snapshot.sagaSelectedCount, '1');
  assert.ok(snapshot.cards > 0 && snapshot.cards < snapshot.totalRows);
  assert.equal(snapshot.allSameSaga, true);
});

test('sort selector changes the first rendered card consistently with app sorting logic', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);

  for (const sortValue of ['title-asc', 'year-desc', 'runtime-desc', 'position-asc']) {
    await setSelectValue(page, '#sortSelect', sortValue);
    const snapshot = await evaluateFunction(page, () => {
      const hooks = window.__MovieExplorerTestHooks;
      const expected = hooks.displayTitle(hooks.sortRows(hooks.filteredRows())[0]);
      const rendered = document.querySelector('.movie-card h2')?.textContent.trim();
      return { expected, rendered };
    });
    assert.equal(snapshot.rendered, snapshot.expected, `${sortValue} should render expected first card`);
  }});

test('sticky result summary tracks filters, sort and selection count', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `document.querySelector('#resultSummary').textContent.includes('1 filtre actif')`, 'summary filter count');

  await setSelectValue(page, '#sortSelect', 'title-asc');
  await click(page, 'button[data-selection-id]');
  await waitForExpression(page, `document.querySelector('#resultSummary').textContent.includes('1 film sélectionné')`, 'summary selection count');

  const snapshot = await evaluateFunction(page, () => {
    const summary = document.querySelector('#resultSummary');
    return {
      text: summary.textContent.replace(/\s+/g, ' ').trim(),
      className: summary.className
    };
  });
  assert.match(snapshot.text, /Tri : Titre A → Z/);
  assert.match(snapshot.text, /1 filtre actif/);
  assert.match(snapshot.text, /1 film sélectionné/);
  assert.equal(snapshot.className, 'result-summary');
});

test('desktop renders the editorial card grid automatically with no display-mode selector', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `window.__MovieExplorerTestHooks.activeCount() === 1`, 'one active filter');
  await waitForExpression(page, `document.querySelector('.movie-card--media')`, 'card grid');

  const cardSnapshot = await evaluateFunction(page, () => ({
    activeCount: window.__MovieExplorerTestHooks.activeCount(),
    mediaRows: document.querySelectorAll('.movie-card--media').length,
    listRows: document.querySelectorAll('.movie-card--list').length,
    seamRows: document.querySelectorAll('.movie-card--media .card-banner + .card-seam + .movie-card__body').length,
    thumbPosterRows: document.querySelectorAll('.movie-card--media .card-thumb').length,
    selectorExists: Boolean(document.querySelector('#viewModeSelect'))
  }));
  assert.equal(cardSnapshot.activeCount, 1);
  assert.ok(cardSnapshot.mediaRows > 0);
  assert.equal(cardSnapshot.listRows, 0);
  assert.equal(cardSnapshot.seamRows, cardSnapshot.mediaRows);
  assert.ok(cardSnapshot.thumbPosterRows >= 1);
  assert.equal(cardSnapshot.selectorExists, false);
});

test('mobile renders card view automatically with no display-mode selector', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await waitForExpression(page, `document.querySelector('.movie-card--media')`, 'mobile card view');

  const snapshot = await evaluateFunction(page, () => ({
    listRows: document.querySelectorAll('.movie-card--list').length,
    cardRows: document.querySelectorAll('.movie-card').length,
    totalRows: window.__MovieExplorerTestHooks.state.rows.length,
    initialLimit: window.__MovieExplorerTestHooks.INITIAL_VISIBLE_MOVIES,
    selectorExists: Boolean(document.querySelector('#viewModeSelect'))
  }));
  assert.equal(snapshot.listRows, 0);
  assert.equal(snapshot.cardRows, Math.min(snapshot.initialLimit, snapshot.totalRows));
  assert.equal(snapshot.selectorExists, false);
});

test('temporary selection can add, review, remove and clear movies', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await click(page, 'button[data-selection-id]');
  await waitForExpression(page, `document.querySelector('#selectionCount').textContent.trim() === '1'`, 'selection count after add');
  assert.equal(await evaluate(page, `document.querySelector('button[data-selection-id][aria-pressed="true"]')?.textContent.trim()`), '✓');

  await setInputValue(page, '#searchInput', 'matrix');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length > 0 && document.querySelectorAll('.movie-card').length < window.__MovieExplorerTestHooks.state.rows.length`, 'search after selecting');
  assert.equal(await evaluate(page, `document.querySelector('#selectionCount').textContent.trim()`), '1');

  await click(page, '#toggleSelectionPanel');
  await waitForExpression(page, `!document.querySelector('#selectionPanel').hidden`, 'selection panel open');
  const openSnapshot = await evaluateFunction(page, () => ({
    panelText: document.querySelector('#selectionPanel').textContent,
    role: document.querySelector('#selectionPanel').getAttribute('role'),
    modal: document.querySelector('#selectionPanel').getAttribute('aria-modal'),
    ariaHidden: document.querySelector('#selectionPanel').getAttribute('aria-hidden'),
    inert: document.querySelector('#selectionPanel').hasAttribute('inert'),
    focusInside: document.querySelector('#selectionPanel').contains(document.activeElement),
    storedSelection: JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]').length,
    selectedButtons: document.querySelectorAll('.selection-toggle.is-selected').length
  }));
  assert.match(openSnapshot.panelText, /Ma sélection/);
  assert.equal(openSnapshot.role, 'dialog');
  assert.equal(openSnapshot.modal, 'true');
  assert.equal(openSnapshot.ariaHidden, 'false');
  assert.equal(openSnapshot.inert, false);
  assert.equal(openSnapshot.focusInside, true);
  assert.equal(openSnapshot.storedSelection, 1);

  const focusTrapSnapshot = await evaluateFunction(page, () => {
    const panel = document.querySelector('#selectionPanel');
    const selector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
    const focusable = [...panel.querySelectorAll(selector)].filter(control => !control.closest('[hidden]') && control.getClientRects().length);
    focusable[focusable.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    return {
      wrappedToFirst: document.activeElement === focusable[0],
      firstLabel: focusable[0].textContent.trim()
    };
  });
  assert.equal(focusTrapSnapshot.wrappedToFirst, true);
  assert.equal(focusTrapSnapshot.firstLabel, 'Vider');

  await click(page, 'button[data-selection-detail-id]');
  await waitForExpression(page, `document.querySelector('#selectionPanel .selection-detail .movie-card')`, 'selection detail card');
  const detailSnapshot = await evaluateFunction(page, () => ({
    hasFullCard: Boolean(document.querySelector('#selectionPanel .selection-detail .movie-card')),
    hasActors: document.querySelector('#selectionPanel .selection-detail .card-credits')?.textContent.length > 0,
    hasPoster: Boolean(document.querySelector('#selectionPanel .selection-detail .movie-poster')),
    expanded: document.querySelector('button[data-selection-detail-id]')?.getAttribute('aria-expanded'),
    summaryFocused: document.activeElement === document.querySelector('button[data-selection-detail-id]')
  }));
  assert.equal(detailSnapshot.hasFullCard, true);
  assert.equal(detailSnapshot.hasActors, true);
  assert.equal(detailSnapshot.hasPoster, true);
  assert.equal(detailSnapshot.expanded, 'true');
  assert.equal(detailSnapshot.summaryFocused, true);

  await click(page, 'button[data-selection-remove-id]');
  await waitForExpression(page, `document.querySelector('#selectionCount').hidden === true`, 'selection count hidden after remove');
  assert.equal(await evaluate(page, `JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]').length`), 0);

  await click(page, 'button[data-selection-id]');
  await waitForExpression(page, `document.querySelector('#selectionCount').textContent.trim() === '1'`, 'selection count after second add');
  await click(page, 'button[data-selection-action="clear"]');
  await waitForExpression(page, `document.querySelector('#selectionCount').hidden === true`, 'selection count hidden after clear');
  assert.equal(await evaluate(page, `localStorage.getItem('movieExplorer.selection')`), null);
});

test('selection items can be reordered from the keyboard', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await evaluateFunction(page, () => {
    [...document.querySelectorAll('.movie-card button[data-selection-id]')].slice(0, 2).forEach(button => button.click());
  });
  await waitForExpression(page, `document.querySelector('#selectionCount').textContent.trim() === '2'`, 'two movies selected');
  await click(page, '#toggleSelectionPanel');
  await waitForExpression(page, `document.querySelectorAll('#selectionPanel .selection-item').length === 2`, 'panel lists two items');

  const before = await evaluateFunction(page, () => ({
    order: [...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim()),
    stored: JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]')
  }));

  const after = await evaluateFunction(page, () => {
    const second = [...document.querySelectorAll('#selectionPanel button[data-selection-move-id]')][1];
    const movedId = second.dataset.selectionMoveId;
    second.focus();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return {
      order: [...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim()),
      stored: JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]'),
      focusOnMoved: document.activeElement?.dataset?.selectionMoveId === movedId,
      live: document.querySelector('#selectionPanel [aria-live]')?.textContent || ''
    };
  });

  assert.deepEqual(after.order, [before.order[1], before.order[0]]);
  assert.deepEqual(after.stored, [before.stored[1], before.stored[0]]);
  assert.equal(after.focusOnMoved, true);
  assert.match(after.live, /position 1/);
});

// Real CDP touch events, unlike synthetic PointerEvents, go through the browser's actual
// input pipeline and so honour touch-action. That matters here: if the drag source ever
// allows the browser to pan, it claims the gesture and fires pointercancel mid-drag, and
// touch reordering silently stops working — a regression synthetic events cannot catch.
function touchSequence(page, x) {
  return (type, y) => page.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openDrawerWith(page, count) {
  await evaluateFunction(page, n => {
    [...document.querySelectorAll('.movie-card button[data-selection-id]')].slice(0, n).forEach(button => button.click());
  }, count);
  await waitForExpression(page, `document.querySelector('#selectionCount').textContent.trim() === '${count}'`, `${count} movies selected`);
  await click(page, '#toggleSelectionPanel');
  await waitForExpression(page, `document.querySelectorAll('#selectionPanel .selection-item').length === ${count}`, 'drawer lists items');
}

// Whether a drag reads as "quick" (scroll) or "held" (reorder) depends on real elapsed time
// against the 320ms long-press in selection-gestures.mjs. A finger always beats it; a
// contended CI runner can stall a CDP round-trip past it and silently invert the gesture,
// making the assertion test the wrong thing. So measure the gap the page actually saw and
// retry when the environment, not the code, was at fault.
const REORDER_HOLD_MS = 320;
function instrumentPointerLag(page) {
  return evaluateFunction(page, () => {
    window.__lag = { down: 0, firstMove: 0 };
    window.addEventListener('pointerdown', () => { window.__lag = { down: performance.now(), firstMove: 0 }; }, true);
    window.addEventListener('pointermove', () => {
      if (window.__lag.down && !window.__lag.firstMove) window.__lag.firstMove = performance.now();
    }, true);
  });
}
function pointerLag(page) {
  return evaluate(page, `window.__lag.firstMove ? Math.round(window.__lag.firstMove - window.__lag.down) : -1`);
}
// Runs `attempt` until the page saw a genuinely quick first move, then returns its result.
async function whenGestureWasQuick(page, attempt) {
  let result;
  for (let tries = 0; tries < 4; tries++) {
    result = await attempt();
    const lag = await pointerLag(page);
    if (lag >= 0 && lag < REORDER_HOLD_MS) return result;
  }
  return result;
}

test('real touch: press-and-hold drags a title to reorder, a quick drag does not', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await openDrawerWith(page, 2);

  const geo = await evaluateFunction(page, () => {
    const items = [...document.querySelectorAll('#selectionPanel .selection-item')];
    const grip = items[0].querySelector('[data-selection-move-id]').getBoundingClientRect();
    const target = items[1].getBoundingClientRect();
    // A browser-issued pointercancel is the signature of the drag being taken away from us
    // (long-press gesture recognizer / pan). Surface it so a failure names its own cause.
    window.__pointerCancelled = false;
    window.addEventListener('pointercancel', () => { window.__pointerCancelled = true; }, true);
    const x = Math.round(grip.left + grip.width / 2);
    const y = Math.round(grip.top + grip.height / 2);
    // What the finger actually lands on, and whether that element cedes the axis to us.
    const hit = document.elementFromPoint(x, y);
    return {
      before: items.map(item => item.querySelector('.selection-item__title').textContent.trim()),
      x,
      y,
      targetY: Math.round(target.top + target.height * 0.8),
      hit: hit ? `${hit.tagName}.${hit.className || '-'} touch-action=${getComputedStyle(hit).touchAction} inSource=${Boolean(hit.closest('[data-selection-move-id]'))}` : 'nothing'
    };
  });
  const touch = touchSequence(page, geo.x);
  await instrumentPointerLag(page);

  // Quick drag (no hold): scrolls, never reorders.
  const quick = await whenGestureWasQuick(page, async () => {
    const orderBefore = await evaluate(page, `[...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim())`);
    await touch('touchStart', geo.y);
    for (let step = 1; step <= 4; step++) await touch('touchMove', geo.y + step * 25);
    await touch('touchEnd', geo.y + 100);
    await sleep(80);
    const orderAfter = await evaluate(page, `[...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim())`);
    return { orderBefore, orderAfter };
  });
  assert.deepEqual(quick.orderAfter, quick.orderBefore, 'a quick drag must not reorder');

  // Press and hold, then drag past the second item: reorders. The hold jitters by a pixel
  // rather than freezing: a real finger never holds perfectly still, and a frozen synthetic
  // touch point is exactly the case that trips the browser's stationary-press recognizer.
  //
  // Chrome intermittently revokes the pointer (pointercancel) shortly after the hold under
  // injected touch, taking the drag with it. That is the harness racing the browser's gesture
  // recogniser, not a product defect, so retry when we observe it — but only when we observe
  // it: if the drag source ever stops owning the touch, every attempt cancels and this still
  // fails, with the cancel named in the message.
  let before = quick.orderAfter;
  let after;
  for (let attempt = 1; attempt <= 4; attempt++) {
    before = await evaluate(page, `[...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim())`);
    await evaluate(page, `window.__pointerCancelled = false`);

    await touch('touchStart', geo.y);
    for (let tick = 0; tick < 3; tick++) {
      await sleep(120);
      await touch('touchMove', geo.y + (tick % 2 ? 1 : -1));
    }
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', Math.round(geo.y + (geo.targetY - geo.y) * (step / 6)));
      await sleep(25);
    }
    await touch('touchEnd', geo.targetY);
    await sleep(120);

    after = await evaluateFunction(page, () => ({
      order: [...document.querySelectorAll('#selectionPanel .selection-item__title')].map(el => el.textContent.trim()),
      stored: JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]'),
      cancelled: window.__pointerCancelled
    }));
    if (!after.cancelled) break; // a clean run is authoritative, pass or fail
  }

  assert.deepEqual(
    after.order,
    [before[1], before[0]],
    `press-and-hold drag should reorder (pointercancel=${after.cancelled}, hit=${geo.hit})`
  );
  assert.equal(after.stored.length, 2);
});

test('real touch: dragging a title still scrolls the drawer', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await openDrawerWith(page, 14); // enough items to overflow the panel

  const geo = await evaluateFunction(page, () => {
    const panel = document.querySelector('#selectionPanel');
    const grip = document.querySelectorAll('#selectionPanel [data-selection-move-id]')[3].getBoundingClientRect();
    return {
      scrollable: panel.scrollHeight > panel.clientHeight,
      scrollTop: panel.scrollTop,
      x: Math.round(grip.left + grip.width / 2),
      y: Math.round(grip.top + grip.height / 2)
    };
  });
  assert.equal(geo.scrollable, true, 'fixture should overflow the drawer');
  assert.equal(geo.scrollTop, 0);

  // The title block sets touch-action:none, so this scroll comes from the JS passthrough.
  const touch = touchSequence(page, geo.x);
  await instrumentPointerLag(page);
  const scrolled = await whenGestureWasQuick(page, async () => {
    await evaluate(page, `document.querySelector('#selectionPanel').scrollTop = 0`);
    await touch('touchStart', geo.y);
    for (let step = 1; step <= 5; step++) {
      await touch('touchMove', geo.y - step * 30);
      await sleep(16);
    }
    await touch('touchEnd', geo.y - 150);
    await sleep(80);
    return evaluate(page, `document.querySelector('#selectionPanel').scrollTop`);
  });
  assert.ok(scrolled > 40, `dragging a title should scroll the drawer, got scrollTop=${scrolled}`);
});

test('swiping the drawer to the right closes it, vertical drags do not', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await evaluateFunction(page, () => document.querySelector('.movie-card button[data-selection-id]').click());
  await click(page, '#toggleSelectionPanel');
  await waitForExpression(page, `document.querySelector('#selectionPanel').classList.contains('is-open')`, 'drawer open');

  // A near-vertical drag must not close the drawer.
  await evaluateFunction(page, () => {
    const panel = document.querySelector('#selectionPanel');
    const rect = panel.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.bottom - 120;
    const opts = extra => ({ bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: x, ...extra });
    panel.dispatchEvent(new PointerEvent('pointerdown', opts({ clientY: y })));
    window.dispatchEvent(new PointerEvent('pointermove', opts({ clientY: y - 130 })));
    window.dispatchEvent(new PointerEvent('pointerup', opts({ clientY: y - 130 })));
  });
  assert.equal(await evaluate(page, `document.querySelector('#selectionPanel').classList.contains('is-open')`), true);

  // A decisive right-swipe closes it.
  await evaluateFunction(page, () => {
    const panel = document.querySelector('#selectionPanel');
    const rect = panel.getBoundingClientRect();
    const startX = rect.left + 40;
    const y = rect.bottom - 120;
    const opts = extra => ({ bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', clientY: y, ...extra });
    panel.dispatchEvent(new PointerEvent('pointerdown', opts({ clientX: startX })));
    window.dispatchEvent(new PointerEvent('pointermove', opts({ clientX: startX + 60 })));
    window.dispatchEvent(new PointerEvent('pointermove', opts({ clientX: startX + 280 })));
    window.dispatchEvent(new PointerEvent('pointerup', opts({ clientX: startX + 280 })));
  });
  await waitForExpression(page, `!document.querySelector('#selectionPanel').classList.contains('is-open')`, 'drawer closed after swipe');

  const closed = await evaluateFunction(page, () => ({
    ariaHidden: document.querySelector('#selectionPanel').getAttribute('aria-hidden'),
    inert: document.querySelector('#selectionPanel').hasAttribute('inert'),
    backdropHidden: document.querySelector('#selectionBackdrop').hidden,
    bodyClass: document.body.classList.contains('selection-open')
  }));
  assert.equal(closed.ariaHidden, 'true');
  assert.equal(closed.inert, true);
  assert.equal(closed.backdropHidden, true);
  assert.equal(closed.bodyClass, false);
});

test('failed reload clears stale cards, active filters and filter lists', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length > 0 && window.__MovieExplorerTestHooks.activeCount() === 1`, 'valid filtered state');

  await evaluateFunction(page, async () => {
    window.MOVIE_EXPLORER_TEST_FIXTURE_MODE = 'missing';
    await window.__MovieExplorerTestHooks.loadSheet();
  });
  await waitForExpression(page, `document.querySelector('#status').textContent.includes('HTTP 404')`, 'HTTP 404 error state');

  const snapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    rows: window.__MovieExplorerTestHooks.state.rows.length,
    activeCount: window.__MovieExplorerTestHooks.activeCount(),
    searchValue: document.querySelector('#searchInput').value,
    genreList: document.querySelector('#genreList').textContent.trim(),
    diagnosticsHidden: document.querySelector('#diagnostics').hidden
  }));
  assert.equal(snapshot.cards, 0);
  assert.equal(snapshot.rows, 0);
  assert.equal(snapshot.activeCount, 0);
  assert.equal(snapshot.searchValue, '');
  assert.equal(snapshot.genreList, 'Aucune donnée chargée');
  assert.equal(snapshot.diagnosticsHidden, true);
});

test('mobile filter panel opens as a dialog and closes on Escape', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  const closed = await evaluateFunction(page, () => ({
    ariaHidden: document.querySelector('#filterPanel').getAttribute('aria-hidden'),
    inert: document.querySelector('#filterPanel').hasAttribute('inert'),
    backdropHidden: document.querySelector('#filterBackdrop').hidden
  }));
  assert.equal(closed.ariaHidden, 'true');
  assert.equal(closed.inert, true);
  assert.equal(closed.backdropHidden, true);

  await click(page, '#openFilters');
  await waitForExpression(page, `document.querySelector('#filterPanel').getAttribute('aria-hidden') === 'false'`, 'mobile filter panel open');
  const open = await evaluateFunction(page, () => ({
    role: document.querySelector('#filterPanel').getAttribute('role'),
    modal: document.querySelector('#filterPanel').getAttribute('aria-modal'),
    bodyClass: document.body.classList.contains('filters-open'),
    backdropHidden: document.querySelector('#filterBackdrop').hidden
  }));
  assert.equal(open.role, 'dialog');
  assert.equal(open.modal, 'true');
  assert.equal(open.bodyClass, true);
  assert.equal(open.backdropHidden, false);

  await evaluate(page, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitForExpression(page, `document.querySelector('#filterPanel').getAttribute('aria-hidden') === 'true'`, 'mobile filter panel closes');
});

test('mobile actor search result can be selected with the first touch after typing', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await click(page, '#openFilters');
  await waitForExpression(page, `document.querySelector('#filterPanel').getAttribute('aria-hidden') === 'false'`, 'open mobile filters');
  await evaluateFunction(page, () => {
    document.querySelector('[data-filter-category="actor"]').click();
  });
  await waitForExpression(page, `!document.querySelector('#actorSection').hidden`, 'actor section visible');
  await setInputValue(page, '#actorFilterSearch', 'matt');
  await waitForExpression(page, `[...document.querySelectorAll('#actorList .filter-option')].some(option => option.textContent.includes('Matt Damon'))`, 'Matt Damon option');

  await evaluateFunction(page, () => {
    const option = [...document.querySelectorAll('#actorList .filter-option')].find(item => item.textContent.includes('Matt Damon'));
    if (!option) throw new Error('Matt Damon option not found');
    option.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
  });
  await waitForExpression(page, `document.querySelector('#activeFilters').textContent.includes('Acteur: Matt Damon')`, 'Matt Damon active filter');

  const snapshot = await evaluateFunction(page, () => ({
    activeCount: window.__MovieExplorerTestHooks.activeCount(),
    actorCount: document.querySelector('#actorSelectedCount').textContent.trim(),
    filterCount: document.querySelector('#filterCount').textContent.trim(),
    selectedButtonPressed: document.querySelector('button[data-card-filter-category="actor"][aria-pressed="true"]') !== null
  }));
  assert.equal(snapshot.activeCount, 1);
  assert.equal(snapshot.actorCount, '1');
  assert.equal(snapshot.filterCount, '1');
  assert.equal(snapshot.selectedButtonPressed, true);
});

const requestedIndex = process.env.MOVIE_EXPLORER_E2E_TEST_INDEX;
const runner = requestedIndex === undefined ? runBrowserTests(tests) : runOneBrowserTest(tests[Number(requestedIndex)]);
runner.catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
