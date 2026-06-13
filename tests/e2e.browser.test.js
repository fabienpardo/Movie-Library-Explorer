#!/usr/bin/env node
const assert = require('node:assert/strict');
const {
  browserTestSkipReason,
  flushPages,
  startChromium,
  createPage,
  evaluate,
  evaluateFunction,
  waitForExpression,
  setInputValue,
  setSelectValue,
  click,
  clickFilterOptionByLabel
} = require('./browser-test-utils');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('loads the fixture and renders the library without browser errors', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  const snapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    statusHidden: document.querySelector('#status').hidden,
    summary: document.querySelector('#resultSummary').textContent.replace(/\s+/g, ' ').trim(),
    diagnosticsHidden: document.querySelector('#diagnostics').hidden,
    firstCardTitle: document.querySelector('.movie-card h2')?.textContent.trim(),
    statCards: document.querySelectorAll('.summary-card').length,
    selectionButtonText: document.querySelector('.movie-card button[data-selection-id]')?.textContent.trim(),
    selectionButtonLabel: document.querySelector('.movie-card button[data-selection-id]')?.getAttribute('aria-label'),
    selectionButtonPosition: getComputedStyle(document.querySelector('.movie-card button[data-selection-id]')).position,
    cardPosition: getComputedStyle(document.querySelector('.movie-card')).position,
    firstPosterSrc: document.querySelector('.movie-card .movie-poster img')?.getAttribute('src'),
    posterCount: document.querySelectorAll('.movie-card .movie-poster img').length,
    gridMode: document.querySelector('#movieGrid').dataset.viewMode,
    hasMediaCard: Boolean(document.querySelector('.movie-card.movie-card--media')),
    hasCardWithPoster: Boolean(document.querySelector('.movie-card.movie-card--with-poster')),
    hasFranchiseBadge: document.querySelectorAll('.franchise-badge').length
  }));

  assert.equal(snapshot.cards, 511);
  assert.equal(snapshot.statusHidden, true);
  assert.match(snapshot.summary, /511\s*\/\s*511 films affichés/);
  assert.equal(snapshot.statCards, 0);
  assert.equal(snapshot.diagnosticsHidden, true);
  assert.ok(snapshot.firstCardTitle);
  assert.equal(snapshot.selectionButtonText, '+');
  assert.equal(snapshot.selectionButtonLabel, 'Ajouter à la sélection');
  assert.equal(snapshot.selectionButtonPosition, 'absolute');
  assert.equal(snapshot.cardPosition, 'relative');
  assert.ok(snapshot.posterCount >= 1);
  assert.equal(snapshot.gridMode, 'cards');
  assert.equal(snapshot.hasMediaCard, true);
  assert.equal(snapshot.hasCardWithPoster, true);
  assert.ok(snapshot.hasFranchiseBadge >= 1);
  assert.match(snapshot.firstPosterSrc, /^https:\/\//);
});

test('search reduces displayed results and clear filters restores them', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await setInputValue(page, '#searchInput', 'matrix');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length > 0 && document.querySelectorAll('.movie-card').length < 511`, 'search results');

  const searchSnapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    activeText: document.querySelector('#activeFilters').textContent,
    allContainQuery: [...document.querySelectorAll('.movie-card')].every(card => card.textContent.toLowerCase().includes('matrix'))
  }));
  assert.ok(searchSnapshot.cards > 0 && searchSnapshot.cards < 511);
  assert.match(searchSnapshot.activeText, /Recherche:\s*matrix/);
  assert.equal(searchSnapshot.allContainQuery, true);

  await click(page, '#clearFilters');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length === 511`, 'full result set after clearing');
  assert.equal(await evaluate(page, `document.querySelector('#activeFilters').textContent.trim()`), '');
});

test('genre checkbox selection updates cards, count badges and selected chips', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await clickFilterOptionByLabel(page, '#genreList', 'Action');
  await waitForExpression(page, `document.querySelector('#activeFilters').textContent.includes('Genre: Action')`, 'Action filter selection');

  const snapshot = await evaluateFunction(page, () => ({
    cards: document.querySelectorAll('.movie-card').length,
    filterCount: document.querySelector('#filterCount').textContent.trim(),
    genreSelectedCount: document.querySelector('#genreSelectedCount').textContent.trim(),
    hasSelectedChip: Boolean(document.querySelector('.genre-chip--selected')),
    allCardsHaveAction: [...document.querySelectorAll('.movie-card')].every(card => card.textContent.includes('Action'))
  }));
  assert.ok(snapshot.cards > 0 && snapshot.cards < 511);
  assert.equal(snapshot.filterCount, '1');
  assert.equal(snapshot.genreSelectedCount, '1');
  assert.equal(snapshot.hasSelectedChip, true);
  assert.equal(snapshot.allCardsHaveAction, true);
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
  await waitForExpression(page, `document.querySelector('#movieGrid').dataset.viewMode === 'cards' && document.querySelector('.movie-card--media')`, 'card grid');

  const cardSnapshot = await evaluateFunction(page, () => ({
    mode: document.querySelector('#movieGrid').dataset.viewMode,
    effectiveMode: window.__MovieExplorerTestHooks.effectiveViewMode(),
    activeCount: window.__MovieExplorerTestHooks.activeCount(),
    mediaRows: document.querySelectorAll('.movie-card--media').length,
    listRows: document.querySelectorAll('.movie-card--list').length,
    seamRows: document.querySelectorAll('.movie-card--media .card-banner + .card-seam + .movie-card__body').length,
    thumbPosterRows: document.querySelectorAll('.movie-card--media .card-thumb img').length,
    selectorExists: Boolean(document.querySelector('#viewModeSelect'))
  }));
  assert.equal(cardSnapshot.mode, 'cards');
  assert.equal(cardSnapshot.effectiveMode, 'cards');
  assert.equal(cardSnapshot.activeCount, 1);
  assert.ok(cardSnapshot.mediaRows > 0);
  assert.equal(cardSnapshot.listRows, 0);
  assert.equal(cardSnapshot.seamRows, cardSnapshot.mediaRows);
  assert.ok(cardSnapshot.thumbPosterRows >= 1);
  assert.equal(cardSnapshot.selectorExists, false);
});

test('mobile renders card view automatically with no display-mode selector', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl, { mobile: true });
  await waitForExpression(page, `document.querySelector('#movieGrid').dataset.viewMode === 'cards'`, 'mobile card view');

  const snapshot = await evaluateFunction(page, () => ({
    effectiveMode: window.__MovieExplorerTestHooks.effectiveViewMode(),
    gridMode: document.querySelector('#movieGrid').dataset.viewMode,
    listRows: document.querySelectorAll('.movie-card--list').length,
    cardRows: document.querySelectorAll('.movie-card').length,
    selectorExists: Boolean(document.querySelector('#viewModeSelect'))
  }));
  assert.equal(snapshot.effectiveMode, 'cards');
  assert.equal(snapshot.gridMode, 'cards');
  assert.equal(snapshot.listRows, 0);
  assert.equal(snapshot.cardRows, 511);
  assert.equal(snapshot.selectorExists, false);
});

test('temporary selection can add, review, remove and clear movies', async ({ browserWsUrl }) => {
  const { page } = await createPage(browserWsUrl);
  await click(page, 'button[data-selection-id]');
  await waitForExpression(page, `document.querySelector('#selectionCount').textContent.trim() === '1'`, 'selection count after add');
  assert.equal(await evaluate(page, `document.querySelector('button[data-selection-id][aria-pressed="true"]')?.textContent.trim()`), '✓');

  await setInputValue(page, '#searchInput', 'matrix');
  await waitForExpression(page, `document.querySelectorAll('.movie-card').length > 0 && document.querySelectorAll('.movie-card').length < 511`, 'search after selecting');
  assert.equal(await evaluate(page, `document.querySelector('#selectionCount').textContent.trim()`), '1');

  await click(page, '#toggleSelectionPanel');
  await waitForExpression(page, `!document.querySelector('#selectionPanel').hidden`, 'selection panel open');
  const openSnapshot = await evaluateFunction(page, () => ({
    panelText: document.querySelector('#selectionPanel').textContent,
    storedSelection: JSON.parse(localStorage.getItem('movieExplorer.selection') || '[]').length,
    selectedButtons: document.querySelectorAll('.selection-toggle.is-selected').length
  }));
  assert.match(openSnapshot.panelText, /Sélection temporaire/);
  assert.equal(openSnapshot.storedSelection, 1);

  await click(page, 'button[data-selection-detail-id]');
  await waitForExpression(page, `document.querySelector('#selectionPanel .selection-detail .movie-card')`, 'selection detail card');
  const detailSnapshot = await evaluateFunction(page, () => ({
    hasFullCard: Boolean(document.querySelector('#selectionPanel .selection-detail .movie-card')),
    hasActors: document.querySelector('#selectionPanel .selection-detail .card-credits')?.textContent.length > 0,
    hasPoster: Boolean(document.querySelector('#selectionPanel .selection-detail .movie-poster img')),
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

(async () => {
  const skipReason = browserTestSkipReason();
  if (skipReason) {
    console.log(`⚠ Skipping browser E2E tests: ${skipReason}`);
    return;
  }

  const chromium = startChromium();
  let browserWsUrl;
  try {
    ({ wsUrl: browserWsUrl } = await chromium.ready);
    let passed = 0;
    for (const { name, fn } of tests) {
      try {
        await fn({ browserWsUrl });
        // Drain and close every page the scenario opened, then fail it on any console error or uncaught exception.
        for (const diagnostics of await flushPages()) {
          assert.deepEqual(diagnostics.consoleErrors, [], `console errors during "${name}"`);
          assert.deepEqual(diagnostics.exceptions, [], `uncaught exceptions during "${name}"`);
        }
        passed += 1;
        console.log(`✓ ${name}`);
      } catch (error) {
        console.error(`✗ ${name}`);
        console.error(error.stack || error.message);
        process.exitCode = 1;
        break;
      }
    }
    if (process.exitCode !== 1) console.log(`\n${passed}/${tests.length} browser E2E scenarios passed.`);
  } finally {
    chromium.child.kill('SIGTERM');
    try { fs.rmSync(chromium.profileDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
