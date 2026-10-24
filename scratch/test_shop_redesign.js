const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9225;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = err => reject(err);
      this.ws.onmessage = msg => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { res, rej } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) {
            rej(new Error(data.error.message));
          } else {
            res(data.result);
          }
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
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
  }

  async screenshot(outputPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  const edgeProcess = spawn(EDGE_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1366,768',
    'about:blank'
  ]);

  console.log('Spawned Edge on port ' + PORT + '...');
  await sleep(1500);

  const results = {
    checks: {},
    desktop1366: {},
    mobile390: {},
    filtering: {},
    screenshots: []
  };

  try {
    const versionInfo = await httpGet(`http://127.0.0.1:${PORT}/json/version`);
    const browserWs = versionInfo.webSocketDebuggerUrl;

    const client = new CDPClient(browserWs);
    await client.connect();

    const { targetId } = await client.send('Target.createTarget', { url: 'http://localhost:3030/#/shop' });
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
    const pageTarget = targets.find(t => t.id === targetId || t.type === 'page');

    const pageClient = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await pageClient.connect();

    await pageClient.send('Page.enable');
    await pageClient.send('DOM.enable');
    await pageClient.send('Runtime.enable');

    console.log('Navigating to http://localhost:3030/#/shop...');
    await pageClient.send('Page.navigate', { url: 'http://localhost:3030/#/shop' });
    await sleep(2000);

    // 1. Desktop 1366px Verification
    await pageClient.setViewport(1366, 768);
    await sleep(400);

    const desktopChecks = await pageClient.evaluate(`({
      shopActive: document.getElementById('screen-shop').classList.contains('active'),
      hasConcreteBg: getComputedStyle(document.getElementById('screen-shop')).backgroundImage.includes('concrete-texture.png'),
      bgColor: getComputedStyle(document.getElementById('screen-shop')).backgroundColor,
      headerTitle: document.querySelector('.shop-title') ? document.querySelector('.shop-title').textContent : null,
      filterCount: document.querySelectorAll('.shop-filter-btn').length,
      cardsCount: document.querySelectorAll('.shop-card').length,
      gridColumns: getComputedStyle(document.querySelector('.shop-grid')).gridTemplateColumns.split(' ').length,
      scrollWidth: document.getElementById('screen-shop').scrollWidth,
      clientWidth: document.getElementById('screen-shop').clientWidth,
      hasHorizontalOverflow: document.getElementById('screen-shop').scrollWidth > document.getElementById('screen-shop').clientWidth
    })`);
    results.desktop1366 = desktopChecks;
    console.log('Desktop 1366px checks:', desktopChecks);

    const shot1366 = path.join(__dirname, '..', 'shop_desktop_1366.png');
    await pageClient.screenshot(shot1366);
    results.screenshots.push(shot1366);

    // 2. Test Category Filtering (e.g. click TOPS)
    console.log('Testing category filter: TOPS...');
    await pageClient.evaluate(`
      const topsBtn = Array.from(document.querySelectorAll('.shop-filter-btn')).find(b => b.textContent.includes('TOPS'));
      if (topsBtn) topsBtn.click();
    `);
    await sleep(400);

    const topsFilterData = await pageClient.evaluate(`({
      activeFilter: document.querySelector('.shop-filter-btn.active') ? document.querySelector('.shop-filter-btn.active').textContent.trim() : null,
      cardsCount: document.querySelectorAll('.shop-card').length,
      headerPillCount: document.querySelector('.shop-count-num') ? document.querySelector('.shop-count-num').textContent : null,
      allCardsAreTops: Array.from(document.querySelectorAll('.shop-card-cat')).every(el => el.textContent.includes('TOPS'))
    })`);
    results.filtering.tops = topsFilterData;
    console.log('Tops filter results:', topsFilterData);

    const shotTops = path.join(__dirname, '..', 'shop_desktop_tops.png');
    await pageClient.screenshot(shotTops);
    results.screenshots.push(shotTops);

    // Test Wishlist Save on first card
    console.log('Testing Wishlist save button...');
    await pageClient.evaluate(`
      const saveBtn = document.querySelector('.shop-card-save-btn');
      if (saveBtn) saveBtn.click();
    `);
    await sleep(250);
    const wishlistState = await pageClient.evaluate(`({
      btnSaved: document.querySelector('.shop-card-save-btn').classList.contains('saved'),
      savedBadge: document.getElementById('savedCountBadge').textContent,
      toastVisible: document.getElementById('toast').classList.contains('show'),
      toastText: document.getElementById('toast').textContent
    })`);
    results.checks.wishlist = wishlistState;
    console.log('Wishlist state:', wishlistState);

    // Reset to ALL
    await pageClient.evaluate(`
      const allBtn = Array.from(document.querySelectorAll('.shop-filter-btn')).find(b => b.textContent.includes('ALL'));
      if (allBtn) allBtn.click();
    `);
    await sleep(400);

    // 3. Mobile 390px Verification
    console.log('Testing Mobile 390px viewport...');
    await pageClient.setViewport(390, 844);
    await sleep(400);

    const mobileChecks = await pageClient.evaluate(`({
      shopActive: document.getElementById('screen-shop').classList.contains('active'),
      gridColumns: getComputedStyle(document.querySelector('.shop-grid')).gridTemplateColumns.split(' ').length,
      scrollWidth: document.getElementById('screen-shop').scrollWidth,
      clientWidth: document.getElementById('screen-shop').clientWidth,
      hasHorizontalOverflow: document.getElementById('screen-shop').scrollWidth > document.getElementById('screen-shop').clientWidth,
      cardsCount: document.querySelectorAll('.shop-card').length
    })`);
    results.mobile390 = mobileChecks;
    console.log('Mobile 390px checks:', mobileChecks);

    const shotMobile = path.join(__dirname, '..', 'shop_mobile_390.png');
    await pageClient.screenshot(shotMobile);
    results.screenshots.push(shotMobile);

    // 4. Test VIEW PIECE from first card
    console.log('Testing VIEW PIECE click from card...');
    await pageClient.evaluate(`
      const firstCta = document.querySelector('.shop-card-cta');
      if (firstCta) firstCta.click();
    `);
    await sleep(400);

    const pieceNavigation = await pageClient.evaluate(`({
      hash: window.location.hash,
      isPieceScreenActive: document.getElementById('screen-piece').classList.contains('active'),
      title: document.querySelector('.piece-title') ? document.querySelector('.piece-title').textContent : null
    })`);
    results.checks.pieceNavigation = pieceNavigation;
    console.log('Piece navigation from card:', pieceNavigation);

    fs.writeFileSync(
      path.join(__dirname, '..', 'shop_redesign_test_results.json'),
      JSON.stringify(results, null, 2)
    );
    console.log('Verification finished! Saved results.');

    await pageClient.close();
    await client.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    edgeProcess.kill();
  }
}

run();
