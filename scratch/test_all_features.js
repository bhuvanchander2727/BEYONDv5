const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9227;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 1; this.callbacks = new Map(); }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = msg => {
        const d = JSON.parse(msg.data);
        if (d.id && this.callbacks.has(d.id)) {
          const { res, rej } = this.callbacks.get(d.id);
          this.callbacks.delete(d.id);
          if (d.error) rej(new Error(d.error.message));
          else res(d.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result ? res.result.value : undefined;
  }
}

async function run() {
  const p = spawn(EDGE_PATH, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', 'about:blank']);
  await sleep(1500);
  try {
    const v = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const c = new CDP(v.webSocketDebuggerUrl);
    await c.connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'http://localhost:3030/#/' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pt = targets.find(t => t.id === targetId || t.type === 'page');
    const pc = new CDP(pt.webSocketDebuggerUrl);
    await pc.connect();
    await pc.send('Page.enable');
    await pc.send('Runtime.enable');
    await pc.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/' });
    await sleep(1500);

    const routesResults = {};

    // 1. Home
    routesResults.home = await pc.evaluate(`({
      screenHomeActive: document.getElementById('screen-home').classList.contains('active'),
      heroRackItems: document.querySelectorAll('#rack .item').length,
      currentProductName: document.getElementById('name').textContent
    })`);

    // 2. Shop
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/shop' });
    await sleep(600);
    routesResults.shop = await pc.evaluate(`({
      screenShopActive: document.getElementById('screen-shop').classList.contains('active'),
      cardsCount: document.querySelectorAll('.shop-card').length,
      bottomTabActive: document.querySelector('.tabs a.tab.on') ? document.querySelector('.tabs a.tab.on').getAttribute('data-route') : null
    })`);

    // 3. Search
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/search' });
    await sleep(600);
    routesResults.search = await pc.evaluate(`({
      screenSearchActive: document.getElementById('screen-search').classList.contains('active'),
      searchInputExists: !!document.getElementById('searchInput'),
      bottomTabActive: document.querySelector('.tabs a.tab.on') ? document.querySelector('.tabs a.tab.on').getAttribute('data-route') : null
    })`);

    // Test search functionality
    await pc.evaluate(`
      const input = document.getElementById('searchInput');
      if (input) {
        input.value = 'leather';
        input.dispatchEvent(new Event('input'));
      }
    `);
    await sleep(300);
    routesResults.searchResults = await pc.evaluate(`({
      resultsCount: document.querySelectorAll('#screen-search .product-card').length,
      firstCardName: document.querySelector('#screen-search .card-name') ? document.querySelector('#screen-search .card-name').textContent.trim() : null
    })`);

    // 4. Saved
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/saved' });
    await sleep(600);
    routesResults.saved = await pc.evaluate(`({
      screenSavedActive: document.getElementById('screen-saved').classList.contains('active'),
      bottomTabActive: document.querySelector('.tabs a.tab.on') ? document.querySelector('.tabs a.tab.on').getAttribute('data-route') : null
    })`);

    // 5. Cart
    await pc.send('Page.navigate', { url: 'http://localhost:3030/#/cart' });
    await sleep(600);
    routesResults.cart = await pc.evaluate(`({
      screenCartActive: document.getElementById('screen-cart').classList.contains('active'),
      bottomTabActive: document.querySelector('.tabs a.tab.on') ? document.querySelector('.tabs a.tab.on').getAttribute('data-route') : null
    })`);

    // 6. Navigation drawer
    await pc.evaluate(`document.getElementById('menuBtn').click();`);
    await sleep(300);
    routesResults.drawer = await pc.evaluate(`({
      drawerOpen: document.getElementById('navDrawer').classList.contains('open'),
      drawerLinks: Array.from(document.querySelectorAll('.drawer-link')).map(l => l.getAttribute('data-route'))
    })`);

    console.log('Full Navigation & Feature Verification:', JSON.stringify(routesResults, null, 2));

    await pc.send('Page.close');
  } catch (e) {
    console.error(e);
  } finally {
    p.kill();
  }
}
run();
