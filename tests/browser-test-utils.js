const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const scriptPath = path.join(rootDir, 'script.js');
const stylePath = path.join(rootDir, 'style.css');
const fixturePath = path.join(rootDir, 'tests', 'fixtures', 'apple-tv-movies-library-mdb.csv');
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
        catch (error) { reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`)); }
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
    await this.opened;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
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
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ];
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });

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

  page.on('Runtime.consoleAPICalled', params => {
    if (params.type === 'error') diagnostics.consoleErrors.push(params.args?.map(arg => arg.value || arg.description).join(' '));
  });
  page.on('Runtime.exceptionThrown', params => diagnostics.exceptions.push(params.exceptionDetails?.text || 'Runtime exception'));

  await page.send('Page.enable');
  await page.send('Runtime.enable');
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
  const script = fs.readFileSync(scriptPath, 'utf8');
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  await evaluateFunction(page, (html, css, fixtureMode, fixtureCsv) => {
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
  }, html, css, options.fixtureMode || '1', fixture);
  await evaluate(page, `${script}\n//# sourceURL=movie-explorer-script.js`);
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
  startChromium,
  createPage,
  evaluate,
  evaluateFunction,
  waitForExpression,
  setInputValue,
  setSelectValue,
  click,
  clickFilterOptionByLabel
};
