#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

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

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('index references only existing local assets', () => {
  const assets = localAssetPathsFromIndex();
  assert.ok(assets.includes('style.css'));
  assert.ok(assets.includes('script.js'));
  for (const asset of assets) assertFileExists(asset);
});

test('manifest references existing icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8'));
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.ok(icon.src, 'manifest icon should define src');
    assertFileExists(stripQuery(icon.src).replace(/^\.\//, ''));
  }
});

test('cache-busting versions are aligned with the current package version', () => {
  const manifest = fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8');
  const versionMatches = [...`${indexHtml}\n${manifest}`.matchAll(/\?v=([^\"']+)/g)].map(match => match[1]);
  assert.ok(versionMatches.length >= 6, 'cache-busted asset references should be present');
  assert.deepEqual([...new Set(versionMatches)], ['8.4.2']);
});

test('removed UI features and fragile selectors do not leave obsolete code paths', () => {
  const css = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
  const script = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
  const appCode = `${indexHtml}
${css}
${script}`;

  assert.doesNotMatch(appCode, /\.summary-card|class=["'][^"']*summary-card/);
  assert.doesNotMatch(appCode, /\.app-subtitle|class=["'][^"']*app-subtitle/);
  assert.doesNotMatch(appCode, /density|comfortable|data-density/i);
  assert.doesNotMatch(script, /data-filter-index|filterIndex/);
  assert.doesNotMatch(script, /selection-detail-\$\{escapeHtml\(id\)/);
});

test('mobile card-only mode has no mobile-specific list layout overrides', () => {
  const css = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
  const mobileBlocks = [...css.matchAll(/@media \(max-width: 759px\) \{([\s\S]*?)\n\}/g)].map(match => match[1]).join('\n');
  assert.doesNotMatch(mobileBlocks, /movie-card--list|movie-list-/);
});


test('roadmap styles include sticky summary and list view hooks', () => {
  const css = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
  assert.match(css, /\.result-summary\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.movie-grid\[data-view-mode="list"\]/);
  assert.match(css, /\.selection-detail/);
});

test('robustness cleanup helpers are present', () => {
  const script = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
  assert.match(script, /function toSafeDomId/);
  assert.match(script, /function reconcilePersistedSelection/);
  assert.match(script, /function fallbackMovieId/);
  assert.match(script, /localStorage\.setItem\(probeKey/);
  assert.match(script, /Aucune colonne URL\/IMDb/);
});

test('test fixture is isolated under tests/fixtures and not used by default source', () => {
  const script = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
  assertFileExists('tests/fixtures/apple-tv-movies-library-mdb.csv');
  assert.match(script, /SHEET_CSV_URL/);
  assert.match(script, /fixtureMode === "1"/);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) console.log(`\n${passed}/${tests.length} static asset scenarios passed.`);
