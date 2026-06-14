const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const stylePath = path.join(rootDir, 'style.css');
const srcDir = path.join(rootDir, 'src');
// Keep this in dependency (topological) order: each module's deps must appear before it.
// The in-page loader rewrites import specifiers to blob URLs in this order, so a module can
// only reference URLs already built. Adding a new src/*.mjs only requires adding it here.
const modulePaths = {
  config: path.join(srcDir, 'config.mjs'),
  utils: path.join(srcDir, 'utils.mjs'),
  dom: path.join(srcDir, 'dom.mjs'),
  state: path.join(srcDir, 'state.mjs'),
  data: path.join(srcDir, 'data.mjs'),
  sorting: path.join(srcDir, 'sorting.mjs'),
  matching: path.join(srcDir, 'matching.mjs'),
  'filter-panel': path.join(srcDir, 'filter-panel.mjs'),
  'render-cards': path.join(srcDir, 'render-cards.mjs'),
  'render-filters': path.join(srcDir, 'render-filters.mjs'),
  selection: path.join(srcDir, 'selection.mjs'),
  app: path.join(srcDir, 'app.mjs'),
  'test-hooks': path.join(srcDir, 'test-hooks.mjs')
};
const fixturePath = path.join(rootDir, 'tests', 'fixtures', 'e2e-movies-library-mdb.csv');
const CDP_COMMAND_TIMEOUT_MS = 8000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);

function findChromium() {
  const executable = CHROMIUM_CANDIDATES.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Chromium executable not found. Set CHROMIUM_PATH to run browser E2E tests.');
  return executable;
}

// Returns a human-readable reason when the environment cannot run browser E2E tests, otherwise null.
// Lets the runner skip cleanly instead of crashing on a missing global or executable.
function browserTestSkipReason() {
  if (typeof WebSocket === 'undefined') {
    return 'global WebSocket is unavailable (requires Node >= 22, or run node with --experimental-websocket).';
  }
  if (!CHROMIUM_CANDIDATES.some(candidate => fs.existsSync(candidate))) {
    return 'no Chromium/Chrome executable found (set CHROMIUM_PATH to enable browser E2E tests).';
  }
  return null;
}

// The runner owns page lifecycle: createPage registers pages here, flushPages drains and closes them between tests.
const openPages = [];
async function flushPages() {
  const pages = openPages.splice(0, openPages.length);
  const diagnostics = [];
  for (const { page, diagnostics: pageDiagnostics } of pages) {
    // One awaited round-trip flushes any console/exception events still in flight: CDP messages are ordered per socket.
    try { await page.send('Runtime.evaluate', { expression: 'void 0' }); } catch {}
    diagnostics.push(pageDiagnostics);
    await page.closeTarget();
  }
  return diagnostics;
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = event => reject(new Error(`WebSocket error for ${wsUrl}: ${event.message || 'unknown error'}`));
    });
    this.ws.onmessage = event => this.handleMessage(event.data);
    this.ws.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP WebSocket closed'));
      this.pending.clear();
    };
  }

  handleMessage(raw) {
    const text = typeof raw === 'string' ? raw : raw.toString();
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
      else resolve(message.result || {});
      return;
    }

    const listeners = this.listeners.get(message.method) || [];
    for (const listener of listeners) listener(message.params || {});
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  async send(method, params = {}) {
    await withTimeout(this.opened, CDP_COMMAND_TIMEOUT_MS, `CDP open ${method}`);
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${CDP_COMMAND_TIMEOUT_MS}ms`));
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
    });
    try {
      this.ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return promise;
  }

  async closeTarget() {
    try { await this.send('Page.close'); } catch {}
    try { this.ws.close(); } catch {}
  }
}

function startChromium() {
  const executable = findChromium();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-explorer-chrome-'));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--blink-settings=imagesEnabled=false',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ];
  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true
  });

  const ready = new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chromium did not expose DevTools in time. stderr:\n${stderr}`)), 15000);
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ wsUrl: match[1], profileDir });
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited before tests could run. Exit code: ${code}. stderr:\n${stderr}`));
    });
  });

  return { child, ready, profileDir };
}

function sanitizedIndexHtml() {
  return fs.readFileSync(indexPath, 'utf8')
    .replace(/<script\b[^>]*src="script\.js[^>]*><\/script>/, '')
    .replace(/<link\b[^>]*href="style\.css[^>]*>/, '');
}

async function createPage(browserWsUrl, options = {}) {
  const browserUrl = new URL(browserWsUrl);
  const httpOrigin = `http://${browserUrl.host}`;
  const target = await requestJson(`${httpOrigin}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const page = new CDPClient(target.webSocketDebuggerUrl);
  const diagnostics = { consoleErrors: [], exceptions: [] };
  openPages.push({ page, diagnostics });

  page.on('Runtime.consoleAPICalled', params => {
    if (params.type === 'error') diagnostics.consoleErrors.push(params.args?.map(arg => arg.value || arg.description).join(' '));
  });
  page.on('Runtime.exceptionThrown', params => diagnostics.exceptions.push(params.exceptionDetails?.text || 'Runtime exception'));

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['http://*/*', 'https://*/*'] });
  if (options.mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  } else {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
  }

  const html = sanitizedIndexHtml();
  const css = fs.readFileSync(stylePath, 'utf8');
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  const moduleSources = Object.fromEntries(
    Object.entries(modulePaths).map(([name, modulePath]) => [name, fs.readFileSync(modulePath, 'utf8')])
  );
  await evaluateFunction(page, (html, css, fixtureMode, fixtureCsv, moduleSources) => {
    document.open();
    document.write(html);
    document.close();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const storage = new Map();
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: key => storage.has(String(key)) ? storage.get(String(key)) : null,
          setItem: (key, value) => { storage.set(String(key), String(value)); },
          removeItem: key => { storage.delete(String(key)); },
          clear: () => { storage.clear(); }
        }
      });
    } catch {}
    window.MOVIE_EXPLORER_TEST_FIXTURE_MODE = fixtureMode;
    window.fetch = async () => {
      const mode = window.MOVIE_EXPLORER_TEST_FIXTURE_MODE;
      if (mode === 'missing') {
        return { ok: false, status: 404, text: async () => 'Not found' };
      }
      return { ok: true, status: 200, text: async () => fixtureCsv };
    };

    const makeModuleUrl = source => URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    // moduleSources is provided in dependency order. Rewrite each module's relative imports to the
    // blob URLs of the modules already built, then publish its own blob URL for later dependents.
    const moduleUrls = {};
    for (const [name, source] of Object.entries(moduleSources)) {
      let rewritten = source;
      for (const [dep, url] of Object.entries(moduleUrls)) {
        rewritten = rewritten.replaceAll(`./${dep}.mjs`, url);
      }
      moduleUrls[name] = makeModuleUrl(rewritten);
    }
    window.__movieExplorerModulePromise = import(moduleUrls['test-hooks']).then(({ initApp, installTestHooks }) => {
      installTestHooks(window);
      initApp();
    });
  }, html, css, options.fixtureMode || '1', fixture, moduleSources);
  await evaluate(page, 'window.__movieExplorerModulePromise');
  await waitForApp(page);
  return { page, diagnostics };
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
  }
  return result.result?.value;
}

async function evaluateFunction(page, fn, ...args) {
  return evaluate(page, `(${fn.toString()})(...${JSON.stringify(args)})`);
}

async function waitUntil(predicate, timeoutMs, label) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForExpression(page, expression, label, timeoutMs = 10000) {
  await waitUntil(async () => Boolean(await evaluate(page, `(() => { try { return Boolean(${expression}); } catch { return false; } })()`)), timeoutMs, label);
}

async function waitForApp(page) {
  try {
    await waitForExpression(
      page,
      `window.__MovieExplorerTestHooks && document.querySelectorAll('.movie-card').length > 0`,
      'movie cards to render'
    );
  } catch (error) {
    const debug = await evaluateFunction(page, () => ({
      readyState: document.readyState,
      href: location.href,
      hasHooks: Boolean(window.__MovieExplorerTestHooks),
      status: document.querySelector('#status')?.textContent,
      cards: document.querySelectorAll('.movie-card').length,
      bodyStart: document.body?.innerText?.slice(0, 500)
    })).catch(debugError => ({ debugError: debugError.message }));
    throw new Error(`${error.message}\nDebug: ${JSON.stringify(debug, null, 2)}`);
  }
}

async function setInputValue(page, selector, value) {
  await evaluateFunction(page, (selector, value) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
}

async function setSelectValue(page, selector, value) {
  await evaluateFunction(page, (selector, value) => {
    const select = document.querySelector(selector);
    if (!select) throw new Error(`Missing select: ${selector}`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

async function click(page, selector) {
  await evaluateFunction(page, selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing clickable element: ${selector}`);
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
  }, selector);
}

async function clickFilterOptionByLabel(page, listSelector, labelText) {
  await evaluateFunction(page, (listSelector, labelText) => {
    const labels = [...document.querySelectorAll(`${listSelector} .filter-option`)];
    const label = labels.find(item => item.textContent.includes(labelText));
    if (!label) throw new Error(`Filter option not found: ${labelText}`);
    label.scrollIntoView({ block: 'center', inline: 'center' });
    const input = label.querySelector('input');
    input.click();
  }, listSelector, labelText);
}


module.exports = {
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
  clickFilterOptionByLabel,
  withTimeout
};
