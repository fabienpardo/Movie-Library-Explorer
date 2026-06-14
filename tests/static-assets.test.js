#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestRegistry, runTests } = require('./helpers/test-runner');

const rootDir = path.resolve(__dirname, '..');
const readRootFile = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const indexHtml = readRootFile('index.html');
const styleCss = readRootFile('style.css');
const manifestText = readRootFile('manifest.webmanifest');
const manifestJson = JSON.parse(manifestText);
// Single source of truth: the bump script (npm run bump) keeps these aligned.
const packageVersion = JSON.parse(readRootFile('package.json')).version;

const { tests, test } = createTestRegistry();

function stripQuery(value) {
  return value.split('?')[0];
}

function localAssetPathsFromIndex() {
  const paths = [];
  for (const match of indexHtml.matchAll(/<(?:link|script)\b[^>]+(?:href|src)="([^"]+)"/g)) {
    const raw = stripQuery(match[1]);
    if (/^(https?:|data:|#)/i.test(raw)) continue;
    paths.push(raw.replace(/^\.\//, ''));
  }
  return paths;
}

function assertFileExists(relativePath) {
  assert.ok(fs.existsSync(path.join(rootDir, relativePath)), `${relativePath} should exist`);
}

function appSource() {
  const script = readRootFile('script.js');
  const srcDir = path.join(rootDir, 'src');
  const modules = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir)
        .filter(name => name.endsWith('.mjs'))
        .sort()
        .map(name => readRootFile(path.join('src', name)))
    : [];
  return [script, ...modules].join('\n');
}

function assertPatternSet(source, checks, assertMethod) {
  for (const [pattern, label] of checks) {
    assert[assertMethod](source, pattern, label);
  }
}

test('index references only existing local assets', () => {
  const assets = localAssetPathsFromIndex();
  assert.ok(assets.includes('style.css'));
  assert.ok(assets.includes('script.js'));
  for (const asset of assets) assertFileExists(asset);
});

test('manifest references existing icons', () => {
  assert.ok(Array.isArray(manifestJson.icons));
  assert.ok(manifestJson.icons.length >= 2);
  for (const icon of manifestJson.icons) {
    assert.ok(icon.src, 'manifest icon should define src');
    assertFileExists(stripQuery(icon.src).replace(/^\.\//, ''));
  }
  assert.ok(manifestJson.icons.some(icon => icon.purpose && icon.purpose.split(/\s+/).includes('maskable')), 'manifest should declare a maskable icon');
});

test('service worker precaches only existing assets at the aligned version', () => {
  const sw = readRootFile('sw.js');
  const versions = [...sw.matchAll(/\?v=([^"']+)/g)].map(match => match[1]);
  assert.ok(versions.length >= 6, 'service worker should cache-bust shell assets');
  assert.deepEqual([...new Set(versions)], [packageVersion], 'service worker asset versions must match the app version');
  assert.ok(sw.includes(`mlx-${packageVersion}`), 'service worker cache name must match the app version');

  const shell = sw.match(/const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(shell, 'SHELL_ASSETS array should be present');
  const assets = [...shell[1].matchAll(/"([^"]+)"/g)].map(match => stripQuery(match[1]).replace(/^\.\//, ''));
  for (const asset of assets) assertFileExists(asset === '' ? 'index.html' : asset);
});

test('cache-busting versions are aligned with the current package version', () => {
  const versionMatches = [...`${indexHtml}\n${manifestText}`.matchAll(/\?v=([^\"']+)/g)].map(match => match[1]);
  assert.ok(versionMatches.length >= 6, 'cache-busted asset references should be present');
  assert.deepEqual([...new Set(versionMatches)], [packageVersion]);
});

test('removed UI features and fragile selectors do not leave obsolete code paths', () => {
  assertPatternSet(`${indexHtml}\n${styleCss}\n${appSource()}`, [
    [/\.summary-card|class=["'][^"']*summary-card/, 'summary cards should stay removed'],
    [/\.app-subtitle|class=["'][^"']*app-subtitle/, 'old app subtitle should stay removed'],
    [/density|comfortable|data-density/i, 'card-density controls should stay removed'],
    [/data-filter-index|filterIndex/, 'fragile filter-index state should stay removed'],
    [/selection-detail-\$\{escapeHtml\(id\)/, 'escaped-string DOM IDs should not return']
  ], 'doesNotMatch');
});

test('card-only mode has no leftover list layout code', () => {
  assertPatternSet(`${styleCss}\n${appSource()}`, [
    [/movie-card--list/, 'list-card modifier should stay removed'],
    [/movie-poster--list/, 'list-poster modifier should stay removed'],
    [/movie-list-/, 'list-view classes should stay removed'],
    [/data-view-mode="list"/, 'list view mode should stay removed'],
    [/renderMovieList/, 'list render helpers should stay removed']
  ], 'doesNotMatch');
});

test('stylesheet is organized into the documented section order', () => {
  const sections = [
    '01 tokens',
    '02 base',
    '03 layout',
    '04 toolbar',
    '05 filter panel',
    '06 movie card',
    '07 selection panel',
    '08 responsive',
    '09 utilities'
  ];

  let previousIndex = -1;
  for (const section of sections) {
    const marker = `   ${section}`;
    const index = styleCss.indexOf(marker);
    assert.ok(index > previousIndex, `${section} should appear after the previous stylesheet section`);
    previousIndex = index;
  }
});

test('roadmap styles include sticky summary and selection detail hooks', () => {
  assertPatternSet(styleCss, [
    [/\.result-summary\s*\{[^}]*position:\s*sticky/s, 'result summary should remain sticky'],
    [/\.selection-detail/, 'selection detail styles should remain present']
  ], 'match');
});

test('robustness cleanup helpers are present', () => {
  assertPatternSet(appSource(), [
    [/function toSafeDomId/, 'safe DOM ID helper should exist'],
    [/function reconcilePersistedSelection/, 'selection reconciliation should exist'],
    [/function fallbackMovieId/, 'fallback ID helper should exist'],
    [/localStorage\.setItem\(probeKey/, 'storage availability probe should exist'],
    [/Aucune colonne URL\/IMDb/, 'missing URL warning should exist']
  ], 'match');
});

test('live app rendering does not use innerHTML-style injection', () => {
  const source = appSource();
  assertPatternSet(source, [
    [/\.innerHTML\s*=/, 'innerHTML assignments should not return'],
    [/insertAdjacentHTML|outerHTML\s*=/, 'HTML string insertion should not return']
  ], 'doesNotMatch');
  assertPatternSet(source, [
    [/replaceChildren\(/, 'DOM replacement should use replaceChildren'],
    [/textContent/, 'user-facing text should use textContent']
  ], 'match');
});

test('test fixture is isolated under tests/fixtures and not used by default source', () => {
  const source = appSource();
  assertFileExists('tests/fixtures/apple-tv-movies-library-mdb.csv');
  assertPatternSet(source, [
    [/SHEET_CSV_URL/, 'production sheet URL constant should exist'],
    [/fixtureMode === "1"/, 'fixture mode should be gated explicitly']
  ], 'match');
});

runTests(tests, { label: 'static asset scenarios' });
